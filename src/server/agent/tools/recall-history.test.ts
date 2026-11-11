import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '#/server/db/client'
import { claims, conversations, messages } from '#/server/db/schema'
import { createRecallHistory } from './recall-history'

const TZ = 'Asia/Kolkata'
const signal = new AbortController().signal
// 3 Nov 2026, 14:05 IST = 08:35 UTC
const nov3 = Date.UTC(2026, 10, 3, 8, 35)
const nov10 = Date.UTC(2026, 10, 10, 6, 0)
const now = Date.UTC(2026, 10, 11, 12, 0)

let handle: ReturnType<typeof createTestDb>

async function seed() {
  const { db } = handle
  await db.insert(conversations).values([
    { id: 'c1', title: 'Postgres hosting', createdAt: nov3 },
    { id: 'c2', title: 'CRM shortlist', createdAt: nov10 },
  ])
  const [q1] = await db
    .insert(messages)
    .values({ conversationId: 'c1', role: 'user', text: 'Which Postgres hosting is cheapest: Neon or Supabase?', createdAt: nov3, timezone: TZ })
    .returning()
  const [a1] = await db
    .insert(messages)
    .values({ conversationId: 'c1', role: 'assistant', text: 'Supabase Pro is $25/month; Neon Launch is usage-based.', createdAt: nov3 + 20_000, timezone: TZ })
    .returning()
  await db.insert(messages).values([
    { conversationId: 'c2', role: 'user', text: 'Shortlist CRM tools for a 20-person sales team', createdAt: nov10, timezone: TZ },
    { conversationId: 'c2', role: 'assistant', text: 'HubSpot, Pipedrive, Salesforce, Close, Attio.', createdAt: nov10 + 20_000, timezone: TZ },
  ])
  await db.insert(claims).values({
    messageId: a1.id,
    entity: 'Supabase',
    attribute: 'Pro plan price',
    value: '$25/month',
    sourceUrl: 'https://supabase.com/pricing',
    observedAt: nov3,
  })
  return { q1, a1 }
}

function tool(beforeMs = now) {
  return createRecallHistory({ timezone: TZ, beforeMs, getDb: () => handle })
}

beforeEach(async () => {
  handle = createTestDb()
  await handle.ready
})

describe('recall_history', () => {
  it('says plainly when there is no history (fresh instance)', async () => {
    const out = await tool().execute({ from: '2026-11-03', to: '2026-11-03' }, { signal })
    expect(out).toMatchObject({ found: 0, messages: [], note: 'No conversations found in this range.' })
  })

  it("finds a day's conversation in the user's timezone, with claims", async () => {
    await seed()
    const out = await tool().execute({ from: '2026-11-03', to: '2026-11-03' }, { signal })
    expect(out.found).toBe(2)
    expect(out.messages[0]).toMatchObject({ role: 'user', at: 'Tue, 3 Nov 2026, 14:05', conversationTitle: 'Postgres hosting' })
    expect(out.messages[1].claims).toEqual([
      { entity: 'Supabase', attribute: 'Pro plan price', value: '$25/month', sourceUrl: 'https://supabase.com/pricing', observedAt: '2026-11-03' },
    ])
  })

  it('misses days with no conversations', async () => {
    await seed()
    const out = await tool().execute({ from: '2026-11-04', to: '2026-11-09' }, { signal })
    expect(out.found).toBe(0)
  })

  it('matches keywords (stemmed) and pairs the question with our answer', async () => {
    await seed()
    const out = await tool().execute({ query: 'postgres host' }, { signal })
    expect(out.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(out.messages[1].text).toContain('$25/month')
  })

  it('reports no keyword matches explicitly', async () => {
    await seed()
    const out = await tool().execute({ query: 'kubernetes' }, { signal })
    expect(out.found).toBe(0)
    expect(out.note).toMatch(/No past messages match/)
  })

  it('treats FTS syntax in user text as plain words', async () => {
    await seed()
    for (const query of ['"unbalanced', 'CRM AND (OR', 'NEAR(x y)', '*', 'c++ / sql:']) {
      await expect(tool().execute({ query }, { signal })).resolves.toBeDefined()
    }
  })

  it('excludes the current turn', async () => {
    await seed()
    const out = await tool(nov10).execute({ query: 'CRM' }, { signal }) // turn started at nov10
    expect(out.found).toBe(0)
  })
})
