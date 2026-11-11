import Exa, { DEFAULT_WEB_SEARCH_TOOL_DESCRIPTION, SEARCH_OBJECTIVE_TOOL_DESCRIPTION } from 'exa-js'
import { z } from 'zod'
import { requireEnv } from '../../env'
import { defineTool } from '../tool'

/**
 * web_search: the agent's only external tool. Exa /search with the request
 * Exa recommends for LLM tools: query + objective, type "auto", highlights
 * (query-anchored excerpts, far fewer tokens than full page text). No
 * numResults/category/domain filters: Exa's defaults beat guesses.
 *
 * Date filters are hard filters that drop every page without a publish
 * date, and official pricing pages have none. A filtered search alone once
 * returned five blog posts instead of the vendor's pricing page. So a dated
 * search never replaces the normal one: both run in parallel and are merged,
 * with each result marked as inside the window or not. And the harness can
 * switch date filters off entirely when the user gave no time window.
 */

type ExaClient = Pick<Exa, 'search'>

const isoDate = z.iso.date().describe('YYYY-MM-DD')

const inputSchema = z.object({
  query: z.string().min(1).describe('Describe the ideal page, in natural language. Put recency ("latest", "2026") here.'),
  objective: z.string().min(1).describe(SEARCH_OBJECTIVE_TOOL_DESCRIPTION),
  since: isoDate
    .optional()
    .describe('Start of a time window the user stated ("since Monday"). Adds pages published on/after this date, marked inWindow. Omit unless the user gave a window; never for "latest".'),
  until: isoDate.optional().describe('End of a user-stated window. Same rule as `since`.'),
})

export type WebSearchInput = z.infer<typeof inputSchema>

export type WebSearchResult = {
  title: string
  url: string
  publishedDate?: string
  author?: string
  /** Only on dated searches: was this page published inside since/until? */
  inWindow?: boolean
  highlights: string[]
}

export type WebSearchOutput = {
  /** When the search ran (UTC ISO). The model cites this as "checked on". */
  searchedAt: string
  /** How to read the results of a dated search, or why dates were ignored. */
  note?: string
  results: WebSearchResult[]
}

export type WebSearchOptions = {
  /** Results per search; Exa's default is 10. */
  numResults?: number
  /** Per-result highlight budget, in characters. */
  maxCharacters?: number
  /** False when the user gave no time window: since/until are then ignored. */
  allowDates?: boolean
}

export function createWebSearch(getClient: () => ExaClient = defaultClient, opts: WebSearchOptions = {}) {
  return defineTool({
    name: 'web_search',
    description: `${DEFAULT_WEB_SEARCH_TOOL_DESCRIPTION} Searches the live web; use it for anything current (prices, releases, news, changelogs). Independent lookups should be separate calls in the same turn so they run in parallel.`,
    inputSchema,
    timeoutMs: 15_000,
    async execute({ query, objective, since, until }, { signal }): Promise<WebSearchOutput> {
      const exa = getClient()
      const search = (dated: boolean) =>
        exa.search(query, {
          type: 'auto',
          objective,
          ...(opts.numResults ? { numResults: opts.numResults } : {}),
          contents: { highlights: opts.maxCharacters ? { maxCharacters: opts.maxCharacters } : true },
          ...(dated && since ? { startPublishedDate: `${since}T00:00:00.000Z` } : {}),
          ...(dated && until ? { endPublishedDate: `${until}T23:59:59.999Z` } : {}),
          signal,
        })
      const toResult = (r: Awaited<ReturnType<typeof search>>['results'][number]): WebSearchResult => ({
        title: r.title ?? r.url,
        url: r.url,
        publishedDate: r.publishedDate?.slice(0, 10),
        author: r.author || undefined,
        highlights: r.highlights ?? [],
      })

      const searchedAt = new Date().toISOString()
      const wantsDates = Boolean(since || until)
      if (!wantsDates || opts.allowDates === false) {
        const res = await search(false)
        return {
          searchedAt,
          note: wantsDates ? 'Date filter ignored: the user gave no time window. These are current results.' : undefined,
          results: res.results.map(toResult),
        }
      }

      // Current state and what was published in the window, side by side.
      const [current, windowed] = await Promise.allSettled([search(false), search(true)])
      if (current.status === 'rejected') throw current.reason
      const range = `${since ?? 'any time'} to ${until ?? 'now'}`
      const inRange = (d?: string) => Boolean(d && (!since || d >= since) && (!until || d <= until))
      const results = current.value.results.map(toResult).map((r) => ({ ...r, inWindow: inRange(r.publishedDate) }))
      const seen = new Set(results.map((r) => r.url))
      const fresh = windowed.status === 'fulfilled' ? windowed.value.results.map(toResult).filter((r) => !seen.has(r.url)) : []
      results.push(...fresh.map((r) => ({ ...r, inWindow: true })))

      const found = results.filter((r) => r.inWindow).length
      return {
        searchedAt,
        note:
          (found
            ? `${found} result(s) marked inWindow were published ${range}.`
            : `No pages were published ${range}; say so rather than implying a change.`) +
          ' The others show the current state: undated pages (pricing pages, docs) are current but do not say when they changed.',
        results,
      }
    },
    sources: (out) => out.results.map((r) => ({ title: r.title, url: r.url, publishedAt: r.publishedDate })),
  })
}

let client: Exa | undefined
function defaultClient(): ExaClient {
  client ??= new Exa(requireEnv('EXA_API_KEY'))
  return client
}

// 5 results, not Exa's default 10: halves the excerpts the model must read
// (~12k vs ~23k tokens for 3 searches) with no loss of correctness in
// bench.live.test.ts. An intentional product decision, per Exa's guidance.
export const webSearch = createWebSearch(undefined, { numResults: 5 })
