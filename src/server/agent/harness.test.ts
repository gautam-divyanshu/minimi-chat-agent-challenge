import { beforeEach, describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTestDb } from '#/server/db/client'
import { conversations, messages, toolEvents } from '#/server/db/schema'
import type { AgentEvent } from '#/shared/events'
import { runTurn } from './harness'
import { defineTool } from './tool'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}
const stream = (parts: any[]) => ({
  stream: new ReadableStream({
    start(c) {
      ;[{ type: 'stream-start', warnings: [] }, ...parts].forEach((p) => c.enqueue(p))
      c.close()
    },
  }),
})
const finish = (reason: 'stop' | 'tool-calls') => ({ type: 'finish', usage, finishReason: { unified: reason, raw: undefined } })

// Turn 1: one search. Turn 2: answer.
function model() {
  return new MockLanguageModelV4({
    doStream: [
      stream([{ type: 'tool-call', toolCallId: 'c1', toolName: 'web_search', input: '{"query":"neon pricing"}' }, finish('tool-calls')]),
      stream([{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'Neon is $0.106/CU-h.' }, { type: 'text-end', id: 't' }, finish('stop')]),
    ] as any,
  })
}

const search = defineTool({
  name: 'web_search',
  description: 's',
  inputSchema: z.object({ query: z.string() }),
  timeoutMs: 1000,
  execute: async () => ({ results: [{ title: 'Neon pricing', url: 'https://neon.com/pricing' }] }),
  sources: (o) => o.results,
})

let handle: ReturnType<typeof createTestDb>
beforeEach(async () => {
  handle = createTestDb()
  await handle.ready
})

describe('runTurn', () => {
  it('streams events and persists messages and tool events', async () => {
    const events: AgentEvent[] = []
    const { messageId } = await runTurn({
      conversationId: 'conv1',
      text: 'What does Neon cost?',
      timezone: 'Asia/Kolkata',
      emit: (e) => events.push(e),
      model: model(),
      tools: () => [search],
      getDb: () => handle,
    })

    expect(events.map((e) => e.type)).toEqual(['turn_started', 'tool_started', 'tool_finished', 'text_delta', 'turn_done'])
    expect(events.at(-1)).toEqual({ type: 'turn_done', messageId })

    const rows = await handle.db.select().from(messages).where(eq(messages.conversationId, 'conv1'))
    expect(rows.map((r) => [r.role, r.text])).toEqual([
      ['user', 'What does Neon cost?'],
      ['assistant', 'Neon is $0.106/CU-h.'],
    ])
    expect(rows[0].timezone).toBe('Asia/Kolkata')

    await new Promise((r) => setTimeout(r, 10)) // tool event insert is fire-and-forget
    const tools = await handle.db.select().from(toolEvents)
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ messageId, tool: 'web_search', input: { query: 'neon pricing' } })
  })

  it('titles a new chat once, and keeps the message as the title if that fails', async () => {
    const title = async (q: string) => `About: ${q}`
    const run = (conversationId: string, text: string, t: typeof title) =>
      runTurn({ conversationId, text, timezone: 'UTC', emit: () => {}, model: model(), tools: () => [search], getDb: () => handle, title: t })
    const titleOf = async (id: string) => (await handle.db.select().from(conversations).where(eq(conversations.id, id)))[0].title

    await run('t1', 'neon pricing', title)
    expect(await titleOf('t1')).toBe('About: neon pricing')
    await run('t1', 'and supabase?', title) // not the first turn: title unchanged
    expect(await titleOf('t1')).toBe('About: neon pricing')

    await run('t2', 'hello there', async () => {
      throw new Error('model down')
    })
    expect(await titleOf('t2')).toBe('hello there')
  })

  it('falls back to UTC for an invalid timezone', async () => {
    await runTurn({
      conversationId: 'conv2',
      text: 'hi',
      timezone: 'Mars/Olympus',
      emit: () => {},
      model: model(),
      tools: () => [search],
      getDb: () => handle,
    })
    const [row] = await handle.db.select().from(messages).where(eq(messages.conversationId, 'conv2'))
    expect(row.timezone).toBe('UTC')
  })

  it('reports a model failure as an error event and still finishes the turn', async () => {
    const events: AgentEvent[] = []
    const broken = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error('401 Incorrect API key provided')
      },
    })
    await runTurn({ conversationId: 'conv3', text: 'hi', timezone: 'UTC', emit: (e) => events.push(e), model: broken, tools: () => [], getDb: () => handle })
    expect(events.map((e) => e.type)).toEqual(['turn_started', 'error', 'turn_done'])
    expect(events[1]).toMatchObject({ message: expect.stringContaining('OPENAI_API_KEY') })
  })
})
