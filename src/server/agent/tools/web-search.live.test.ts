import { it } from 'vitest'
import '#/server/env'
import { webSearch } from '#/server/agent/tools/web-search'

it('returns dated, highlighted results from Exa', async () => {
  for (const input of [
    { query: 'Neon serverless Postgres pricing page', objective: 'Official Neon pricing page; pull plan names and monthly prices.' },
    { query: 'HubSpot CRM product announcements', objective: 'Official HubSpot announcements or changelog entries; pull what shipped and the date.', since: '2026-11-09' },
  ]) {
    const t0 = Date.now()
    const out = await webSearch.execute(input as any, { signal: AbortSignal.timeout(15000) })
    const chars = out.results.reduce((n, r) => n + r.highlights.join('').length, 0)
    console.log(`\n${input.query} — ${Date.now() - t0}ms, ${out.results.length} results, ${chars} highlight chars${out.note ? ', NOTE: retried unfiltered' : ''}`)
    for (const r of out.results.slice(0, 4)) console.log(`  ${r.publishedDate ?? 'undated'}  ${r.url}\n    ${(r.highlights[0] ?? '').slice(0, 140).replace(/\s+/g, ' ')}`)
  }
})
