import { and, asc, eq, gt, gte, inArray, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb as defaultGetDb } from '../../db/client'
import { claims, conversations, messages } from '../../db/schema'
import { endOfDayMs, formatLocal, startOfDayMs } from '../dates'
import { defineTool } from '../tool'

/**
 * recall_history: the agent's own memory. web_search is the only EXTERNAL
 * tool; this one reads our SQLite so questions like "what did I ask you on
 * 3 November?" are answered from records, never invented.
 *
 * Exact by design: date ranges are SQL on a real column, keywords are FTS5.
 * Each matched question comes back with the answer we gave, plus the claims
 * (prices, versions…) extracted from that answer, so "is it still correct?"
 * can be checked against a fresh search.
 */

type Handle = ReturnType<typeof defaultGetDb>

export type RecallContext = {
  /** IANA timezone; from/to are calendar days in this zone. */
  timezone: string
  /** Only messages created before this instant (excludes the current turn). */
  beforeMs: number
  getDb?: () => Handle
}

const MAX_MESSAGES = 20
const MAX_CHARS = { user: 1000, assistant: 1500 }

const inputSchema = z.object({
  from: z.iso.date().optional().describe("First day to include (YYYY-MM-DD, user's calendar)."),
  to: z.iso.date().optional().describe('Last day to include, inclusive. For a single day set from = to.'),
  query: z.string().optional().describe('Topic keywords, e.g. "Postgres hosting" or "CRM". Omit to get everything in the range.'),
})

export type RecalledMessage = {
  conversationId: string
  conversationTitle: string | null
  role: 'user' | 'assistant'
  /** In the user's timezone, e.g. "Tue, 3 Nov 2026, 14:05". */
  at: string
  atIso: string
  text: string
  claims?: { entity: string; attribute: string; value: string; sourceUrl: string | null; observedAt: string }[]
}

export type RecallOutput = {
  found: number
  searched: { from?: string; to?: string; query?: string; timezone: string }
  note?: string
  messages: RecalledMessage[]
}

export function createRecallHistory(ctx: RecallContext) {
  const getDb = ctx.getDb ?? defaultGetDb
  return defineTool({
    name: 'recall_history',
    description:
      'Look up past conversations with this user: what they asked and what you answered, with timestamps and the facts (prices, versions) you reported. Use for any question about earlier conversations ("what did I ask on 3 November?", "last Tuesday we discussed…"). If it returns nothing, say there is no record; never guess.',
    inputSchema,
    timeoutMs: 5_000,
    async execute({ from, to, query }): Promise<RecallOutput> {
      const { db, ready } = getDb()
      await ready
      const tz = ctx.timezone
      const searched = { from, to, query, timezone: tz }

      const conds = [lt(messages.createdAt, ctx.beforeMs)]
      if (from) conds.push(gte(messages.createdAt, startOfDayMs(from, tz)))
      if (to) conds.push(lt(messages.createdAt, endOfDayMs(to, tz)))

      // Keywords → FTS5 ids ranked by relevance. Terms are quoted so user text
      // can't inject FTS syntax; OR keeps recall high, bm25 orders it.
      let rankedIds: number[] | undefined
      const terms = query?.match(/[\p{L}\p{N}]+/gu)
      if (terms?.length) {
        const match = terms.map((t) => `"${t}"`).join(' OR ')
        const rows = await db.all<[number]>(
          sql`select rowid from messages_fts where messages_fts match ${match} order by rank limit 200`,
        )
        rankedIds = rows.map((r) => r[0])
        if (rankedIds.length === 0) return empty(searched, 'No past messages match these keywords in this range.')
        conds.push(inArray(messages.id, rankedIds))
      }

      const select = {
        id: messages.id,
        conversationId: messages.conversationId,
        conversationTitle: conversations.title,
        role: messages.role,
        text: messages.text,
        createdAt: messages.createdAt,
      }
      let hits = await db
        .select(select)
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(and(...conds))
        .orderBy(asc(messages.createdAt))

      if (hits.length === 0) return empty(searched, 'No conversations found in this range.')

      if (rankedIds) {
        // Keep the most relevant, then pair each matched question with our answer.
        const rank = new Map(rankedIds.map((id, i) => [id, i]))
        hits = hits.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!).slice(0, MAX_MESSAGES / 2)
        const have = new Set(hits.map((h) => h.id))
        for (const h of [...hits]) {
          if (h.role !== 'user') continue
          const [reply] = await db
            .select(select)
            .from(messages)
            .innerJoin(conversations, eq(conversations.id, messages.conversationId))
            .where(
              and(
                eq(messages.conversationId, h.conversationId),
                eq(messages.role, 'assistant'),
                gt(messages.createdAt, h.createdAt),
                lt(messages.createdAt, ctx.beforeMs),
              ),
            )
            .orderBy(asc(messages.createdAt))
            .limit(1)
          if (reply && !have.has(reply.id)) {
            hits.push(reply)
            have.add(reply.id)
          }
        }
        hits.sort((a, b) => a.createdAt - b.createdAt)
      }

      const truncated = hits.length > MAX_MESSAGES
      // Date-only ranges keep the most recent messages when over the cap.
      if (truncated) hits = hits.slice(-MAX_MESSAGES)

      const claimRows = await db
        .select()
        .from(claims)
        .where(inArray(claims.messageId, hits.map((h) => h.id)))
      const claimsByMessage = Map.groupBy(claimRows, (c) => c.messageId)

      return {
        found: hits.length,
        searched,
        note: truncated ? `More messages exist in this range; showing the latest ${MAX_MESSAGES}. Narrow the range or add keywords.` : undefined,
        messages: hits.map((h) => ({
          conversationId: h.conversationId,
          conversationTitle: h.conversationTitle,
          role: h.role,
          at: formatLocal(h.createdAt, tz),
          atIso: new Date(h.createdAt).toISOString(),
          text: clip(h.text, MAX_CHARS[h.role]),
          claims: claimsByMessage.get(h.id)?.map((c) => ({
            entity: c.entity,
            attribute: c.attribute,
            value: c.value,
            sourceUrl: c.sourceUrl,
            observedAt: new Date(c.observedAt).toISOString().slice(0, 10),
          })),
        })),
      }
    },
  })
}

function empty(searched: RecallOutput['searched'], note: string): RecallOutput {
  return { found: 0, searched, note, messages: [] }
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}
