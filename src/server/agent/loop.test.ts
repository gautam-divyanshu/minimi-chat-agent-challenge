import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import type { AgentEvent } from '#/shared/events'
import { runAgentLoop } from './loop'
import { defineTool } from './tool'

// --- helpers: scripted model turns -----------------------------------------

type Turn = { text?: string; calls?: { name: string; input: object }[] }

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
}

function streamOf(turn: Turn, i: number) {
  const parts: any[] = [{ type: 'stream-start', warnings: [] }]
  if (turn.text) {
    parts.push({ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: turn.text }, { type: 'text-end', id: 't' })
  }
  turn.calls?.forEach((c, j) =>
    parts.push({ type: 'tool-call', toolCallId: `call_${i}_${j}`, toolName: c.name, input: JSON.stringify(c.input) }),
  )
  parts.push({
    type: 'finish',
    usage,
    finishReason: { unified: turn.calls?.length ? 'tool-calls' : 'stop', raw: undefined },
  })
  return {
    stream: new ReadableStream({
      start(ctrl) {
        parts.forEach((p) => ctrl.enqueue(p))
        ctrl.close()
      },
    }),
  }
}

function scriptedModel(turns: Turn[]) {
  let i = 0
  return new MockLanguageModelV4({
    doStream: async () => {
      const turn = turns[Math.min(i, turns.length - 1)]
      return streamOf(turn, i++) as any
    },
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const search = defineTool({
  name: 'web_search',
  description: 'search',
  inputSchema: z.object({ query: z.string() }),
  timeoutMs: 1000,
  async execute({ query }) {
    await sleep(50)
    return { results: [{ title: query, url: `https://example.com/${query}` }] }
  },
  sources: (o) => o.results,
})

function collect() {
  const events: AgentEvent[] = []
  return { events, onEvent: (e: AgentEvent) => events.push(e) }
}

const user = (text: string) => [{ role: 'user' as const, content: text }]

// --- tests -------------------------------------------------------------------

describe('runAgentLoop', () => {
  it('answers directly when no tool is needed', async () => {
    const { events, onEvent } = collect()
    const res = await runAgentLoop({ model: scriptedModel([{ text: 'Hello!' }]), system: 's', messages: user('hi'), tools: [search], onEvent })
    expect(res.text).toBe('Hello!')
    expect(res.steps).toBe(1)
    expect(events).toEqual([{ type: 'text_delta', text: 'Hello!' }])
  })

  it('runs independent tool calls in parallel and feeds results back', async () => {
    const model = scriptedModel([
      { calls: ['a', 'b', 'c', 'd', 'e'].map((q) => ({ name: 'web_search', input: { query: q } })) },
      { text: 'Done.' },
    ])
    const { events, onEvent } = collect()
    const t0 = Date.now()
    const res = await runAgentLoop({ model, system: 's', messages: user('5 CRMs'), tools: [search], onEvent })

    expect(Date.now() - t0).toBeLessThan(200) // 5 × 50ms sequentially would be ≥250ms
    expect(res.toolRuns).toHaveLength(5)
    expect(res.text).toBe('Done.')
    // All five start before any finishes.
    const kinds = events.map((e) => e.type)
    expect(kinds.slice(0, 5)).toEqual(Array(5).fill('tool_started'))
    const finished = events.filter((e) => e.type === 'tool_finished')
    expect(finished[0]).toMatchObject({ sources: [{ url: 'https://example.com/a' }] })

    // Second model call saw the tool results.
    const prompt = JSON.stringify(model.doStreamCalls[1].prompt)
    expect(prompt).toContain('https://example.com/e')
  })

  it('turns a hung tool into a timeout result instead of hanging the turn', async () => {
    const hang = defineTool({
      name: 'web_search',
      description: 's',
      inputSchema: z.object({ query: z.string() }),
      timeoutMs: 50,
      execute: () => new Promise(() => {}), // never resolves, ignores the signal
    })
    const model = scriptedModel([{ calls: [{ name: 'web_search', input: { query: 'x' } }] }, { text: 'Search timed out.' }])
    const { events, onEvent } = collect()
    const res = await runAgentLoop({ model, system: 's', messages: user('q'), tools: [hang], onEvent })

    expect(res.toolRuns[0].error).toBe('timeout')
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_finished', error: 'timeout' }))
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain('timeout')
  })

  it('returns thrown errors and unknown tools as results, never throws', async () => {
    const broken = defineTool({
      name: 'web_search',
      description: 's',
      inputSchema: z.object({ query: z.string() }),
      timeoutMs: 1000,
      execute: async () => {
        throw new Error('Exa 500')
      },
    })
    const model = scriptedModel([
      { calls: [{ name: 'web_search', input: { query: 'x' } }, { name: 'nope', input: {} }] },
      { text: 'ok' },
    ])
    const res = await runAgentLoop({ model, system: 's', messages: user('q'), tools: [broken], ...collect() })
    expect(res.toolRuns.map((r) => r.error)).toEqual(['Exa 500', expect.stringContaining('nope')])
    expect(res.text).toBe('ok')
    // Exactly one tool-result per call (no duplicates from the SDK for the invalid call).
    const results = res.messages.flatMap((m) =>
      m.role === 'tool' ? m.content.filter((p) => p.type === 'tool-result').map((p) => p.toolCallId) : [],
    )
    expect(results.sort()).toEqual(['call_0_0', 'call_0_1'])
  })

  it('caps steps and forces a final answer without tools', async () => {
    const model = scriptedModel([
      { calls: [{ name: 'web_search', input: { query: 'x' } }] }, // model keeps wanting to search
    ])
    // The mock ignores toolChoice, so make the forced step answer.
    let n = 0
    const choices: (string | undefined)[] = []
    const orig = model.doStream
    model.doStream = async (o) => {
      choices.push(o.toolChoice?.type)
      return ++n === 3 ? (streamOf({ text: 'Best answer so far.' }, n) as any) : orig(o)
    }

    const res = await runAgentLoop({ model, system: 's', messages: user('q'), tools: [search], maxSteps: 3, ...collect() })
    expect(res.steps).toBe(3)
    expect(choices).toEqual(['auto', 'auto', 'none'])
    expect(res.text).toBe('Best answer so far.')
  })
})
