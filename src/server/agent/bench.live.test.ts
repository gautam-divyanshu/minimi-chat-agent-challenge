import { it } from 'vitest'
import '#/server/env'
import type { AgentEvent } from '#/shared/events'
import { runAgentLoop } from './loop'
import { getModel } from './model'
import { buildSystemPrompt } from './prompt'
import { createWebSearch } from './tools/web-search'

// Speed bench: same question across reasoning effort × search payload size.
const QUESTION = 'Compare the cheapest paid plans of Neon, Supabase and PlanetScale right now.'
const configs = [
  { name: 'old default (effort default, 10 results)', settings: undefined, search: {} },
  { name: 'low effort, short, 5 results', settings: { openai: { reasoningEffort: 'low', textVerbosity: 'low' } }, search: { numResults: 5 } },
  { name: 'minimal effort, short, 5 results', settings: { openai: { reasoningEffort: 'minimal', textVerbosity: 'low' } }, search: { numResults: 5 } },
]

it.each(configs)('$name', async ({ name, settings, search }) => {
  const t0 = Date.now()
  let firstText = 0
  const queries: string[] = []
  const res = await runAgentLoop({
    model: getModel(),
    providerOptions: settings,
    system: buildSystemPrompt({ now: new Date(), timezone: 'Asia/Kolkata' }),
    messages: [{ role: 'user', content: QUESTION }],
    tools: [createWebSearch(undefined, search)],
    onEvent: (e: AgentEvent) => {
      if (e.type === 'text_delta' && !firstText) firstText = Date.now() - t0
      if (e.type === 'tool_started') queries.push((e.input as any).query)
    },
  })
  const s = res.stepStats
  console.log(
    `\n### ${name}\nfirst text ${(firstText / 1000).toFixed(1)}s, total ${((Date.now() - t0) / 1000).toFixed(1)}s, ${s.length} model calls, ${queries.length} searches` +
      s.map((x, i) => `\n  call ${i + 1}: ${(x.ms / 1000).toFixed(1)}s, in=${x.inputTokens} out=${x.outputTokens} (reasoning ${x.reasoningTokens}), tools=${x.toolCalls}`).join('') +
      `\n  queries: ${queries.map((q) => JSON.stringify(q)).join(' | ')}` +
      `\n  answer: ${res.text.replace(/\s+/g, ' ').slice(0, 700)}`,
  )
})
