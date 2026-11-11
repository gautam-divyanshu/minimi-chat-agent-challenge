import { describe, expect, it } from 'vitest'
import { createWebSearch, type WebSearchOptions } from './web-search'

type Page = { title: string; url: string; publishedDate?: string; highlights: string[] }

// Fake Exa: answers by whether the call carries a date filter, like the real one.
function fakeExa(pages: { undated: Page[]; dated: Page[] | Error }, opts?: WebSearchOptions) {
  const calls: { query: string; opts: any }[] = []
  const client = {
    search: async (query: string, o: any) => {
      calls.push({ query, opts: o })
      const filtered = Boolean(o.startPublishedDate || o.endPublishedDate)
      const res = filtered ? pages.dated : pages.undated
      if (res instanceof Error) throw res
      return { results: res } as any
    },
  }
  return { calls, tool: createWebSearch(() => client as any, opts) }
}

// The real failure: the official pricing page is undated, blogs are dated.
const pricing: Page = { title: 'Pricing', url: 'https://claude.com/pricing', highlights: ['Pro $20/month'] }
const blog: Page = { title: 'Claude pricing explained', url: 'https://13k.eu/claude', publishedDate: '2026-10-09T00:00:00.000Z', highlights: ['…'] }
const news: Page = { title: 'Fable 5.2 launch', url: 'https://anthropic.com/fable', publishedDate: '2026-11-09T00:00:00.000Z', highlights: ['$8 / $40'] }
const signal = new AbortController().signal

describe('web_search', () => {
  it('sends the recommended Exa request and forwards objective unchanged', async () => {
    const { calls, tool } = fakeExa({ undated: [pricing], dated: [] })
    const out = await tool.execute({ query: 'Claude pricing page', objective: 'official pricing page' }, { signal })
    expect(calls).toHaveLength(1)
    expect(calls[0].opts).toEqual({ type: 'auto', objective: 'official pricing page', contents: { highlights: true }, signal })
    expect(out.note).toBeUndefined()
    expect(out.results).toEqual([{ title: 'Pricing', url: 'https://claude.com/pricing', publishedDate: undefined, author: undefined, highlights: ['Pro $20/month'] }])
    expect(tool.sources!(out)).toEqual([{ title: 'Pricing', url: 'https://claude.com/pricing', publishedAt: undefined }])
  })

  it('a dated search keeps the undated official page (regression: since dropped claude.com/pricing)', async () => {
    const { calls, tool } = fakeExa({ undated: [pricing, blog], dated: [news, blog] })
    const out = await tool.execute({ query: 'q', objective: 'o', since: '2026-11-01' }, { signal })

    // Both searches ran: one unfiltered, one with inclusive day bounds.
    expect(calls).toHaveLength(2)
    expect(calls.map((c) => c.opts.startPublishedDate)).toEqual([undefined, '2026-11-01T00:00:00.000Z'])

    // Official page first, in-window news added, the duplicate blog only once.
    expect(out.results.map((r) => [r.url, r.inWindow])).toEqual([
      ['https://claude.com/pricing', false],
      ['https://13k.eu/claude', false], // published 9 Oct: before the window
      ['https://anthropic.com/fable', true],
    ])
    expect(out.note).toMatch(/1 result\(s\) marked inWindow/)
  })

  it('maps until to an inclusive end of day', async () => {
    const { calls, tool } = fakeExa({ undated: [], dated: [] })
    await tool.execute({ query: 'q', objective: 'o', since: '2026-11-09', until: '2026-11-11' }, { signal })
    expect(calls[1].opts).toMatchObject({ startPublishedDate: '2026-11-09T00:00:00.000Z', endPublishedDate: '2026-11-11T23:59:59.999Z' })
  })

  it('says so when nothing was published in the window', async () => {
    const { tool } = fakeExa({ undated: [pricing], dated: [] })
    const out = await tool.execute({ query: 'q', objective: 'o', since: '2026-11-09' }, { signal })
    expect(out.results).toHaveLength(1)
    expect(out.note).toMatch(/No pages were published 2026-11-09 to now/)
  })

  it('still answers from current results if the dated search fails', async () => {
    const { tool } = fakeExa({ undated: [pricing], dated: new Error('Exa 500') })
    const out = await tool.execute({ query: 'q', objective: 'o', since: '2026-11-09' }, { signal })
    expect(out.results.map((r) => r.url)).toEqual(['https://claude.com/pricing'])
  })

  it('ignores since/until when the user gave no time window', async () => {
    const { calls, tool } = fakeExa({ undated: [pricing], dated: [blog] }, { allowDates: false })
    const out = await tool.execute({ query: 'q', objective: 'o', since: '2026-01-01' }, { signal })
    expect(calls).toHaveLength(1)
    expect(calls[0].opts.startPublishedDate).toBeUndefined()
    expect(out.results.map((r) => r.url)).toEqual(['https://claude.com/pricing'])
    expect(out.note).toMatch(/Date filter ignored/)
  })

  it('requires objective and real dates in the model-facing schema', () => {
    const { tool } = fakeExa({ undated: [], dated: [] })
    expect(tool.inputSchema.safeParse({ query: 'q' }).success).toBe(false)
    expect(tool.inputSchema.safeParse({ query: 'q', objective: 'o', since: 'last monday' }).success).toBe(false)
  })
})
