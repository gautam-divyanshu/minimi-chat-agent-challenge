import { expect, it } from 'vitest'
import '#/server/env'
import type { AgentEvent } from '#/shared/events'
import { runAgentLoop } from './loop'
import { getModel } from './model'
import { webSearch } from './tools/web-search'

it('answers a current-facts question with real OpenAI + Exa', async () => {
  const events: AgentEvent[] = []
  const t0 = Date.now()
  let firstText = 0
  const res = await runAgentLoop({
    model: getModel(),
    system: `Today is ${new Date().toDateString()}. Search for anything current. Cite sources with their dates. Be concise.`,
    messages: [{ role: 'user', content: 'What do Neon and Supabase charge for their cheapest paid Postgres plan right now?' }],
    tools: [webSearch],
    onEvent: (e) => {
      if (e.type === 'text_delta' && !firstText) firstText = Date.now() - t0
      events.push(e)
    },
  })
  const tools = events.filter((e) => e.type === 'tool_started')
  console.log(`steps=${res.steps} searches=${tools.length} firstText=${firstText}ms total=${Date.now() - t0}ms`)
  for (const t of tools) console.log('  search:', JSON.stringify((t as any).input))
  console.log('\n' + res.text)
  expect(tools.length).toBeGreaterThan(0)
  expect(res.text.length).toBeGreaterThan(50)
})
