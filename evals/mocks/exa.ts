import type { MockPage } from '../types'

/**
 * A fake Exa client for evals: returns fixture pages whose keywords appear in
 * the query, and applies the published-date filter the way Exa does (a dated
 * search drops undated pages). The real web_search tool runs on top of it, so
 * the dated/undated merge logic is part of what gets evaluated.
 */
export function fakeExa(pages: MockPage[], fails = false) {
  return {
    search: async (query: string, opts: any) => {
      if (fails) throw new Error('search service unavailable (503)')
      const q = query.toLowerCase()
      let hits = pages.filter((p) => p.match.some((m) => q.includes(m.toLowerCase())))
      const since: string | undefined = opts.startPublishedDate?.slice(0, 10)
      const until: string | undefined = opts.endPublishedDate?.slice(0, 10)
      if (since || until) {
        hits = hits.filter((p) => p.publishedDate && (!since || p.publishedDate >= since) && (!until || p.publishedDate <= until))
      }
      return {
        results: hits.slice(0, opts.numResults ?? 10).map((p) => ({
          id: p.url,
          title: p.title,
          url: p.url,
          publishedDate: p.publishedDate ? `${p.publishedDate}T00:00:00.000Z` : undefined,
          highlights: [p.text],
        })),
      } as any
    },
  }
}
