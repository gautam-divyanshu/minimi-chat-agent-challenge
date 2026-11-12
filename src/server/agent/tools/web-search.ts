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

// Models sometimes send "" for an optional date; accept it and treat it as absent.
const isoDate = z.union([z.iso.date(), z.literal('')]).describe('YYYY-MM-DD')

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
  /**
   * Start of the window the user stated, resolved by the harness (YYYY-MM-DD).
   * Applied when the model leaves `since` out: it tends to write "last 48
   * hours" into the query text instead of setting the filter.
   */
  defaultSince?: string
}

// An empty list alone reads to the model like a broken tool ("I can't reach the web").
const NO_RESULTS = 'The search ran and found no matching pages. Search is working: rephrase the query once, or tell the user nothing was found for it.'

export function createWebSearch(getClient: () => ExaClient = defaultClient, opts: WebSearchOptions = {}) {
  return defineTool({
    name: 'web_search',
    description: `${DEFAULT_WEB_SEARCH_TOOL_DESCRIPTION} Searches the live web; use it for anything current (prices, releases, news, changelogs). Independent lookups should be separate calls in the same turn so they run in parallel.`,
    inputSchema,
    timeoutMs: 15_000,
    refineInput(input) {
      const since = input.since || undefined
      const until = input.until || undefined
      if (opts.allowDates === false) return { ...input, since: undefined, until: undefined }
      return { ...input, since: since ?? opts.defaultSince, until }
    },
    async execute(input, ctx): Promise<WebSearchOutput> {
      try {
        return await run(input, ctx)
      } catch (err) {
        throw new Error(searchError(err))
      }
    },
    sources: (out) => out.results.map((r) => ({ title: r.title, url: r.url, publishedAt: r.publishedDate })),
  })

  async function run(
    { query, objective, since, until }: { query: string; objective: string; since?: string; until?: string },
    { signal }: { signal: AbortSignal },
  ): Promise<WebSearchOutput> {
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
      const results = res.results.map(toResult)
      return {
        searchedAt,
        note: !results.length
          ? NO_RESULTS
          : wantsDates
            ? 'Date filter ignored: the user gave no time window. These are current results.'
            : undefined,
        results,
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
    if (!results.length) return { searchedAt, note: NO_RESULTS, results }
    return {
      searchedAt,
      note:
        (found
          ? `${found} result(s) marked inWindow were published ${range}.`
          : `No pages were published ${range}; say so rather than implying a change.`) +
        ' The others show the current state: undated pages (pricing pages, docs) are current but do not say when they changed.',
      results,
    }
  }
}

/**
 * A key problem is the one search failure the user can fix, so say exactly
 * what to fix. The model sees this as the tool result and the UI shows it on
 * the search row.
 */
export function searchError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const status = (err as { statusCode?: number })?.statusCode
  if (/EXA_API_KEY is not set/.test(message)) return 'web search is unavailable: EXA_API_KEY is missing in .env'
  if (status === 401 || status === 403 || /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid api key/i.test(message))
    return 'web search is unavailable: Exa rejected EXA_API_KEY. Check it in .env'
  if (status === 402 || status === 429 || /credits|rate limit|quota/i.test(message))
    return 'web search is unavailable: Exa rate limit or credits exhausted'
  return `web search failed: ${message}`
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
