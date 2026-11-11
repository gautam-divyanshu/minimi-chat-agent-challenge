import { desc, eq, inArray, max, sql } from 'drizzle-orm'
import type { Source } from '#/shared/events'
import { getDb } from './db/client'
import { conversations, messages, toolEvents } from './db/schema'
import { webSearch, type WebSearchOutput } from './agent/tools/web-search'

// Read side of the API: sidebar list and one conversation's messages.

export type ConversationSummary = { id: string; title: string | null; updatedAt: number }

export type ToolCallView = { tool: string; input: unknown; sources: Source[]; error?: string; durationMs: number | null }

export type MessageView = {
  id: number
  role: 'user' | 'assistant'
  text: string
  createdAt: number
  tools: ToolCallView[]
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const { db, ready } = getDb()
  await ready
  const updatedAt = max(messages.createdAt)
  const rows = await db
    .select({ id: conversations.id, title: conversations.title, updatedAt })
    .from(conversations)
    .leftJoin(messages, eq(messages.conversationId, conversations.id))
    .groupBy(conversations.id)
    .orderBy(desc(sql`coalesce(${updatedAt}, ${conversations.createdAt})`))
    .limit(100)
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt ?? 0 }))
}

export async function getConversation(id: string): Promise<{ id: string; title: string | null; messages: MessageView[] } | null> {
  const { db, ready } = getDb()
  await ready
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, id))
  if (!conv) return null

  const rows = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt)
  const ids = rows.filter((r) => r.role === 'assistant').map((r) => r.id)
  const events = ids.length ? await db.select().from(toolEvents).where(inArray(toolEvents.messageId, ids)).orderBy(toolEvents.startedAt) : []
  const byMessage = Map.groupBy(events, (e) => e.messageId)

  return {
    id: conv.id,
    title: conv.title,
    messages: rows.map((r) => ({
      id: r.id,
      role: r.role,
      text: r.text,
      createdAt: r.createdAt,
      tools: (byMessage.get(r.id) ?? []).map((e) => {
        const out = e.output as Record<string, unknown> | null
        const error = typeof out?.error === 'string' ? out.error : undefined
        return {
          tool: e.tool,
          input: e.input,
          error,
          durationMs: e.durationMs,
          sources: e.tool === 'web_search' && out && !error ? webSearch.sources!(out as WebSearchOutput) : [],
        }
      }),
    })),
  }
}
