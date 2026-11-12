import { beforeEach, describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { eq } from 'drizzle-orm'
import { createTestDb, recoverInterrupted } from '#/server/db/client'
import { conversations, messages } from '#/server/db/schema'
import type { AgentEvent } from '#/shared/events'
import { followTurn, isRunning, startTurn, stopTurn, turnFinished } from './turns'

// A model that writes one word every `gapMs`, and stops when aborted.
function slowModel(words: string[], gapMs: number) {
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream({
        async start(c) {
          c.enqueue({ type: 'stream-start', warnings: [] })
          c.enqueue({ type: 'text-start', id: 't' })
          for (const w of words) {
            await new Promise((r) => setTimeout(r, gapMs))
            if (abortSignal?.aborted) return c.error(abortSignal.reason)
            c.enqueue({ type: 'text-delta', id: 't', delta: w })
          }
          c.enqueue({ type: 'text-end', id: 't' })
          c.enqueue({
            type: 'finish',
            usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
            finishReason: { unified: 'stop', raw: undefined },
          })
          c.close()
        },
      }),
    }) as any,
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const words = Array.from({ length: 12 }, (_, i) => `w${i} `)
const full = words.join('')
const textOf = (events: AgentEvent[]) => events.flatMap((e) => (e.type === 'text_delta' ? [e.text] : [])).join('')

let handle: ReturnType<typeof createTestDb>
let id: string
const assistantRow = async () => (await handle.db.select().from(messages).where(eq(messages.conversationId, id))).find((m) => m.role === 'assistant')!
const start = (gapMs: number) => startTurn({ conversationId: id, text: 'hi', timezone: 'UTC', model: slowModel(words, gapMs), tools: () => [], getDb: () => handle })

beforeEach(async () => {
  handle = createTestDb()
  await handle.ready
  id = crypto.randomUUID()
})

describe('turns: a turn outlives the request that started it', () => {
  it('a page that loads mid-answer gets the events it missed, then the rest', async () => {
    expect(start(20)).toBe(true)
    await sleep(110) // "refresh": nobody is listening for a while
    const events: AgentEvent[] = []
    let ended = false
    const unsubscribe = followTurn(id, (e) => events.push(e), () => (ended = true))
    expect(unsubscribe).not.toBeNull()
    expect(textOf(events).length).toBeGreaterThan(0) // replayed part
    expect(textOf(events)).not.toBe(full) // still running

    await turnFinished(id)
    expect(ended).toBe(true)
    expect(events[0].type).toBe('turn_started')
    expect(events.at(-1)?.type).toBe('turn_done')
    expect(textOf(events)).toBe(full)
    expect(isRunning(id)).toBe(false)
    expect(followTurn(id, () => {}, () => {})).toBeNull()
  })

  it('saves the partial answer while it streams', async () => {
    start(70) // 12 words × 70ms ≈ 840ms; partial saves happen every 500ms
    await sleep(700)
    const mid = await assistantRow()
    expect(mid.status).toBe('streaming')
    expect(mid.text.length).toBeGreaterThan(0)
    expect(mid.text).not.toBe(full)

    await turnFinished(id)
    const end = await assistantRow()
    expect(end).toMatchObject({ status: 'done', text: full })
  })

  it('Stop ends the turn and keeps what was written, without an error', async () => {
    start(30)
    const events: AgentEvent[] = []
    followTurn(id, (e) => events.push(e), () => {})
    await sleep(150)
    expect(stopTurn(id)).toBe(true)
    await turnFinished(id)

    const row = await assistantRow()
    expect(row.status).toBe('stopped')
    expect(row.text.length).toBeGreaterThan(0)
    expect(row.text).not.toBe(full)
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(events.at(-1)?.type).toBe('turn_done')
    expect(stopTurn(id)).toBe(false) // nothing left to stop
  })

  it('refuses a second turn in a conversation that is still answering', async () => {
    expect(start(10)).toBe(true)
    expect(start(10)).toBe(false)
    await turnFinished(id)
    expect(start(10)).toBe(true)
    await turnFinished(id)
  })
})

describe('crash recovery', () => {
  it('marks answers left mid-stream by a previous process as interrupted', async () => {
    await handle.db.insert(conversations).values({ id, createdAt: 1 })
    await handle.db.insert(messages).values([
      { conversationId: id, role: 'user', text: 'q', createdAt: 1, timezone: 'UTC' },
      { conversationId: id, role: 'assistant', text: 'Half an ans', createdAt: 2, timezone: 'UTC', status: 'streaming' },
    ])
    await recoverInterrupted(handle).ready
    expect(await assistantRow()).toMatchObject({ status: 'interrupted', text: 'Half an ans' })
  })
})
