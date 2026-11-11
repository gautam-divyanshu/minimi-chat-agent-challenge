import { expect, it } from 'vitest'
import '#/server/env'
import { createTestDb } from '#/server/db/client'
import { toolEvents } from '#/server/db/schema'
import type { AgentEvent } from '#/shared/events'
import { runTurn } from './harness'

// Regression: the model once added `since` on its own, the date filter hid the
// undated official pricing pages, and the answer cited price aggregators.
const official = (url: string) => /(^|\.)(anthropic\.com|claude\.com)$/.test(new URL(url).hostname)

async function ask(text: string) {
  const handle = createTestDb()
  const t0 = Date.now()
  let firstText = 0
  let answer = ''
  await runTurn({
    conversationId: crypto.randomUUID(),
    text,
    timezone: 'Asia/Kolkata',
    getDb: () => handle,
    emit: (e: AgentEvent) => {
      if (e.type !== 'text_delta') return
      firstText ||= Date.now() - t0
      answer += e.text
    },
  })
  await new Promise((r) => setTimeout(r, 50))
  const searches = (await handle.db.select().from(toolEvents)).filter((e) => e.tool === 'web_search')
  const results = searches.flatMap((s) => ((s.output as any).results ?? []) as { url: string; inWindow?: boolean }[])
  console.log(
    `\n### ${text}\nfirst text ${(firstText / 1000).toFixed(1)}s, total ${((Date.now() - t0) / 1000).toFixed(1)}s, ${searches.length} searches, ${results.filter((r) => official(r.url)).length}/${results.length} official results` +
      searches.map((s) => `\n  ${JSON.stringify({ query: (s.input as any).query, since: (s.input as any).since })}`).join('') +
      `\n${answer}`,
  )
  return { answer, searches, results }
}

it('finds and cites the official pricing page', async () => {
  const { answer, results } = await ask('telling pricing of claude models')
  expect(results.some((r) => official(r.url) && /pricing/.test(r.url))).toBe(true)
  expect(answer).toMatch(/\]\(https:\/\/[^)]*(claude\.com|anthropic\.com)/)
})

it('keeps the official page when the user does give a window', async () => {
  const { results } = await ask('Has Anthropic changed Claude API pricing since Monday?')
  expect(results.some((r) => official(r.url) && /pricing/.test(r.url))).toBe(true)
})
