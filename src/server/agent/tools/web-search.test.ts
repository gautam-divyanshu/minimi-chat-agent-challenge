import { describe, expect, it } from 'vitest'
import { createWebSearch } from './web-search'

function fakeExa(responses: { results: any[] }[]) {
  const calls: { query: string; opts: any }[] = []
  let i = 0
  const client = {
    search: async (query: string, opts: any) => {
      calls.push({ query, opts })
      return responses[Math.min(i++, responses.length - 1)] as any
    },
  }
  return { calls, tool: createWebSearch(() => client as any) }
}

const page = { title: 'HubSpot pricing', url: 'https://hubspot.com/pricing', publishedDate: '2026-11-09T00:00:00.000Z', highlights: ['Starter $20/seat'] }
const signal = new AbortController().signal

describe('web_search', () => {
  it('sends the recommended Exa request and forwards objective unchanged', async () => {
    const { calls, tool } = fakeExa([{ results: [page] }])
    const out = await tool.execute({ query: 'HubSpot CRM pricing', objective: 'official pricing page' }, { signal })
    expect(calls).toHaveLength(1)
    expect(calls[0].opts).toEqual({ type: 'auto', objective: 'official pricing page', contents: { highlights: true }, signal })
    expect(out.results[0]).toEqual({ title: 'HubSpot pricing', url: 'https://hubspot.com/pricing', publishedDate: '2026-11-09', author: undefined, highlights: ['Starter $20/seat'] })
    expect(tool.sources!(out)).toEqual([{ title: 'HubSpot pricing', url: 'https://hubspot.com/pricing', publishedAt: '2026-11-09' }])
  })

  it('maps since/until to inclusive published-date filters', async () => {
    const { calls, tool } = fakeExa([{ results: [page] }])
    await tool.execute({ query: 'q', objective: 'o', since: '2026-11-09', until: '2026-11-11' }, { signal })
    expect(calls[0].opts).toMatchObject({ startPublishedDate: '2026-11-09T00:00:00.000Z', endPublishedDate: '2026-11-11T23:59:59.999Z' })
  })

  it('retries without dates when the filtered search is empty, and says so', async () => {
    const { calls, tool } = fakeExa([{ results: [] }, { results: [page] }])
    const out = await tool.execute({ query: 'q', objective: 'o', since: '2026-11-09' }, { signal })
    expect(calls).toHaveLength(2)
    expect(calls[1].opts.startPublishedDate).toBeUndefined()
    expect(out.note).toMatch(/unfiltered/)
    expect(out.results).toHaveLength(1)
  })

  it('requires objective in the model-facing schema', () => {
    const { tool } = fakeExa([{ results: [] }])
    expect(tool.inputSchema.safeParse({ query: 'q' }).success).toBe(false)
    expect(tool.inputSchema.safeParse({ query: 'q', objective: 'o', since: 'last monday' }).success).toBe(false)
  })
})
