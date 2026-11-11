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
 * Date filters are hard filters that drop undated pages (pricing pages often
 * have no date), so they are only for a window the user stated ("since
 * Monday"), and an empty filtered search is retried without them.
 */

type ExaClient = Pick<Exa, 'search'>

const isoDate = z.iso.date().describe('YYYY-MM-DD')

const inputSchema = z.object({
  query: z.string().min(1).describe('Describe the ideal page, in natural language. Put recency ("latest", "2026") here.'),
  objective: z.string().min(1).describe(SEARCH_OBJECTIVE_TOOL_DESCRIPTION),
  since: isoDate
    .optional()
    .describe('Only pages published on/after this date. Use ONLY for a window the user stated ("since Monday"); never for "latest".'),
  until: isoDate.optional().describe('Only pages published on/before this date. Same rule as `since`.'),
})

export type WebSearchInput = z.infer<typeof inputSchema>

export type WebSearchResult = {
  title: string
  url: string
  publishedDate?: string
  author?: string
  highlights: string[]
}

export type WebSearchOutput = {
  /** When the search ran (UTC ISO). The model cites this as "checked on". */
  searchedAt: string
  /** Set when a date-filtered search found nothing and was retried unfiltered. */
  note?: string
  results: WebSearchResult[]
}

export function createWebSearch(getClient: () => ExaClient = defaultClient) {
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
          contents: { highlights: true },
          ...(dated && since ? { startPublishedDate: `${since}T00:00:00.000Z` } : {}),
          ...(dated && until ? { endPublishedDate: `${until}T23:59:59.999Z` } : {}),
          signal,
        })

      const searchedAt = new Date().toISOString()
      const dated = Boolean(since || until)
      let res = await search(dated)
      let note: string | undefined
      if (dated && res.results.length === 0) {
        res = await search(false)
        note = `No pages with a publish date in the requested range (${since ?? '…'} to ${until ?? '…'}). These results are unfiltered: check each page's date before treating it as a change in that window; undated pages (e.g. pricing pages) show current state, not when it changed.`
      }

      return {
        searchedAt,
        note,
        results: res.results.map((r) => ({
          title: r.title ?? r.url,
          url: r.url,
          publishedDate: r.publishedDate?.slice(0, 10),
          author: r.author || undefined,
          highlights: r.highlights ?? [],
        })),
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

export const webSearch = createWebSearch()
