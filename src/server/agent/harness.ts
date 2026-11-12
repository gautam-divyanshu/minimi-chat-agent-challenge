import type { LanguageModel, ModelMessage } from 'ai'
import { asc, eq } from 'drizzle-orm'
import { getDb as defaultGetDb } from '../db/client'
import { conversations, messages, toolEvents } from '../db/schema'
import type { AgentEvent } from '#/shared/events'
import { runAgentLoop } from './loop'
import { getModel, MODEL_SETTINGS } from './model'
import { buildSystemPrompt, FINAL_STEP_NOTE } from './prompt'
import type { AgentTool } from './tool'
import { createRecallHistory } from './tools/recall-history'
import { createWebSearch } from './tools/web-search'
import { formatDateHints, mentionsTimeWindow, resolveDates } from './dates'
import { getTracing, type Tracing } from './tracing'
import { cleanCitations } from '../../shared/citations'

/**
 * One chat turn, end to end. Framework-free: the HTTP route, evals and a CLI
 * all call this. The database is the source of truth; every event is both
 * emitted (to the stream) and persisted as it happens: tool events when they
 * finish, the answer text every SAVE_EVERY_MS while it streams. A refresh or a
 * dropped connection loses nothing, and a crash loses at most half a second.
 */

export type TurnInput = {
  conversationId: string
  text: string
  /** IANA timezone from the browser. */
  timezone: string
  emit: (event: AgentEvent) => void
  signal?: AbortSignal
  // Injection points for tests and evals:
  now?: number
  model?: LanguageModel
  tools?: (ctx: { timezone: string; beforeMs: number; allowDates: boolean; defaultSince?: string }) => AgentTool[]
  getDb?: typeof defaultGetDb
  tracing?: Tracing
}

/** How often the partly written answer is saved while it streams. */
const SAVE_EVERY_MS = 500

/** How many past messages of this conversation the model sees verbatim. */
const HISTORY_MESSAGES = 20

export async function runTurn(input: TurnInput): Promise<{ messageId: number }> {
  const { conversationId, text, emit, signal } = input
  const timezone = validTimezone(input.timezone)
  const now = input.now ?? Date.now()
  const { db, ready } = (input.getDb ?? defaultGetDb)()
  await ready

  // 1. Conversation + user message.
  await db
    .insert(conversations)
    .values({ id: conversationId, title: text.slice(0, 80), createdAt: now })
    .onConflictDoNothing()
  await db.insert(messages).values({ conversationId, role: 'user', text, createdAt: now, timezone })
  emit({ type: 'turn_started', conversationId })

  // 2. Assistant message row up front, so tool events can reference it.
  const [assistant] = await db
    .insert(messages)
    .values({ conversationId, role: 'assistant', text: '', createdAt: now + 1, timezone, status: 'streaming' })
    .returning({ id: messages.id })

  // 3. Context: recent turns of this conversation, oldest first.
  const history = await db
    .select({ role: messages.role, text: messages.text })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
  const context: ModelMessage[] = history
    .filter((m) => m.text !== '')
    .slice(-HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.text }))

  // Date filters are only available when the user named a time window, in
  // this message or the last few (so "and what about Pipedrive?" keeps one).
  const recentUserText = history.filter((m) => m.role === 'user').slice(-3).map((m) => m.text)
  const allowDates = recentUserText.some(mentionsTimeWindow)

  // Relative dates are resolved here, in the user's timezone, and handed to
  // the model as facts. The earliest one is also the default search window.
  const dates = resolveDates(text, now, timezone)
  const defaultSince = dates.map((d) => d.from).sort()[0]

  const tools = input.tools
    ? input.tools({ timezone, beforeMs: now, allowDates, defaultSince })
    : [
        // 5 results, not Exa's default 10: see the note in web-search.ts.
        createWebSearch(undefined, { numResults: 5, allowDates, defaultSince }),
        createRecallHistory({ timezone, beforeMs: now }),
      ]

  // 4. The loop. Text and tool events stream out and are saved as they land.
  let answer = ''
  let status: 'done' | 'stopped' | 'error' = 'done'
  let lastSave = 0
  let saving: Promise<unknown> = Promise.resolve()
  const savePartial = () => {
    if (Date.now() - lastSave < SAVE_EVERY_MS) return
    lastSave = Date.now()
    const snapshot = answer
    // Chained so an older snapshot can never land after a newer one.
    saving = saving
      .then(() => db.update(messages).set({ text: snapshot }).where(eq(messages.id, assistant.id)))
      .catch((err) => console.error('partial save failed', err))
  }
  try {
    const tracing = input.tracing ?? (await getTracing())
    const loop = () => runAgentLoop({
      tracing,
      model: input.model ?? getModel(),
      providerOptions: MODEL_SETTINGS,
      finalStepNote: FINAL_STEP_NOTE,
      system: buildSystemPrompt({ now: new Date(now), timezone, dateHints: formatDateHints(dates) }),
      messages: context,
      tools,
      signal,
      onEvent: (e) => {
        if (e.type === 'text_delta') {
          answer += e.text
          savePartial()
        }
        emit(e)
      },
      onToolRun: (run) => {
        void db
          .insert(toolEvents)
          .values({
            messageId: assistant.id,
            tool: run.tool,
            input: run.input,
            output: run.error ? { error: run.error } : run.output,
            startedAt: run.startedAt,
            durationMs: run.durationMs,
          })
          .catch((err) => console.error('tool_events insert failed', err))
      },
    })
    // One trace per turn; conversations group as sessions in Laminar.
    const result = await tracing.span({ name: 'chat.turn', sessionId: conversationId, input: { text, timezone } }, loop)
    // Stored answers are what recall_history returns later: keep their links valid.
    answer = cleanCitations(result.text)
  } catch (err) {
    if (signal?.aborted) {
      // The user pressed Stop: keep what was written, it is not an error.
      status = 'stopped'
    } else {
      const message = err instanceof Error ? err.message : String(err)
      console.error('turn failed', err)
      status = 'error'
      emit({ type: 'error', message: friendlyError(message) })
      if (!answer) answer = `_Something went wrong: ${friendlyError(message)}_`
    }
  }

  // 5. Final answer.
  await saving
  await db.update(messages).set({ text: cleanCitations(answer), status }).where(eq(messages.id, assistant.id))
  emit({ type: 'turn_done', messageId: assistant.id })
  return { messageId: assistant.id }
}

function validTimezone(tz: string | undefined): string {
  try {
    if (tz) {
      new Intl.DateTimeFormat('en-US', { timeZone: tz })
      return tz
    }
  } catch {}
  return 'UTC'
}

function friendlyError(message: string): string {
  if (/api key|401|unauthorized/i.test(message)) return 'the model API key was rejected. Check OPENAI_API_KEY in .env.'
  if (/is not set/.test(message)) return message
  if (/rate limit|429/i.test(message)) return 'the model is rate-limited right now. Try again in a moment.'
  if (/model.*(does not exist|not found)|404/i.test(message)) return 'OPENAI_MODEL names a model this key cannot use. Check it in .env.'
  return message
}
