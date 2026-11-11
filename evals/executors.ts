import { streamText } from 'ai'
import '../src/server/env'
import { startOfDayMs } from '../src/server/agent/dates'
import { runTurn } from '../src/server/agent/harness'
import { toSdkTools } from '../src/server/agent/loop'
import { getModel, MODEL_SETTINGS } from '../src/server/agent/model'
import { buildSystemPrompt } from '../src/server/agent/prompt'
import { createRecallHistory } from '../src/server/agent/tools/recall-history'
import { createWebSearch } from '../src/server/agent/tools/web-search'
import { getTracing } from '../src/server/agent/tracing'
import { createTestDb } from '../src/server/db/client'
import { conversations, messages, toolEvents } from '../src/server/db/schema'
import { fakeExa } from './mocks/exa'
import type { MultiTurnData, MultiTurnResult, SingleTurnData, SingleTurnResult, ToolCall } from './types'

// A fixed clock makes date questions deterministic:
// Wednesday 11 November 2026, 12:00 in Asia/Kolkata.
// So "Monday" = 2026-11-09 and "3 November" was a Tuesday.
export const EVAL_TZ = 'Asia/Kolkata'
export const EVAL_NOW = Date.UTC(2026, 10, 11, 6, 30)

/**
 * Single-turn: one model call with the real system prompt and real tool
 * schemas. Tools are not executed; we only look at what the model asked for.
 */
export async function singleTurn(data: SingleTurnData): Promise<SingleTurnResult> {
  const tools = [
    createWebSearch(() => fakeExa([]) as any),
    createRecallHistory({ timezone: EVAL_TZ, beforeMs: EVAL_NOW }),
  ]
  const t0 = Date.now()
  const result = streamText({
    model: getModel(),
    providerOptions: MODEL_SETTINGS,
    system: buildSystemPrompt({ now: new Date(EVAL_NOW), timezone: EVAL_TZ }),
    messages: [{ role: 'user', content: data.prompt }],
    tools: toSdkTools(tools),
    telemetry: (await getTracing()).telemetry,
    maxRetries: 1,
  })
  const toolCalls: ToolCall[] = []
  let text = ''
  for await (const part of result.stream) {
    if (part.type === 'text-delta') text += part.text
    if (part.type === 'tool-call') toolCalls.push({ toolName: part.toolName, args: (part.input ?? {}) as Record<string, unknown> })
    if (part.type === 'error') throw part.error
  }
  return { toolCalls, toolNames: toolCalls.map((t) => t.toolName), text, seconds: (Date.now() - t0) / 1000 }
}

/**
 * Multi-turn: full chat turns through the real harness (runTurn) on a seeded
 * in-memory database. recall_history is real; web_search is the real tool on a
 * fake Exa client that serves the case's fixture pages.
 */
export async function multiTurn(data: MultiTurnData): Promise<MultiTurnResult> {
  const handle = createTestDb()
  await handle.ready
  const { db } = handle

  // Seed past conversations.
  const seen = new Set<string>()
  for (const m of data.seed ?? []) {
    const [date, time] = m.at.split(' ')
    const [h, min] = time.split(':').map(Number)
    const at = startOfDayMs(date, EVAL_TZ) + (h * 60 + min) * 60_000
    if (!seen.has(m.conversation)) {
      seen.add(m.conversation)
      await db.insert(conversations).values({ id: m.conversation, title: m.conversation, createdAt: at })
    }
    await db.insert(messages).values({ conversationId: m.conversation, role: m.role, text: m.text, createdAt: at, timezone: EVAL_TZ })
  }

  const exa = fakeExa(data.pages ?? [], data.searchFails)
  const conversationId = `eval-${crypto.randomUUID()}`
  let answer = ''
  let toolCalls: ToolCall[] = []
  let seconds = 0
  let firstTextSeconds = 0

  for (const [i, prompt] of data.prompts.entries()) {
    answer = ''
    toolCalls = []
    firstTextSeconds = 0
    const t0 = Date.now()
    await runTurn({
      conversationId,
      text: prompt,
      timezone: EVAL_TZ,
      now: EVAL_NOW + i * 60_000,
      getDb: () => handle,
      tools: ({ timezone, beforeMs, allowDates }) => [
        createWebSearch(() => exa as any, { numResults: 5, allowDates }),
        createRecallHistory({ timezone, beforeMs, getDb: () => handle }),
      ],
      emit: (e) => {
        if (e.type === 'text_delta') {
          firstTextSeconds ||= (Date.now() - t0) / 1000
          answer += e.text
        }
        if (e.type === 'tool_started') toolCalls.push({ toolName: e.tool, args: (e.input ?? {}) as Record<string, unknown> })
      },
    })
    seconds = (Date.now() - t0) / 1000
  }

  // What the tools returned across the conversation (tool_events are saved as they finish).
  await new Promise((r) => setTimeout(r, 50))
  const events = await db.select().from(toolEvents).orderBy(toolEvents.startedAt)
  const returnedUrls = events.flatMap((e) => (((e.output as any)?.results ?? []) as { url: string }[]).map((r) => r.url))
  const toolResults = events
    .map((e) => `${e.tool}(${JSON.stringify(e.input)}) →\n${JSON.stringify(e.output).slice(0, 3500)}`)
    .join('\n\n')

  return { answer, toolCalls, toolNames: toolCalls.map((t) => t.toolName), returnedUrls, toolResults, seconds, firstTextSeconds }
}
