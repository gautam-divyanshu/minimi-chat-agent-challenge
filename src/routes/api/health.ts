import { createFileRoute } from '@tanstack/react-router'
import { sql } from 'drizzle-orm'
import { getDb, schema } from '#/server/db/client'

// Spike: proves node:sqlite + Drizzle + FTS5 run inside TanStack Start.
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        const { db, ready } = getDb()
        await ready
        const id = crypto.randomUUID()
        await db.insert(schema.conversations).values({ id, createdAt: Date.now() })
        const [msg] = await db
          .insert(schema.messages)
          .values({ conversationId: id, role: 'user', text: 'Postgres hosting pricing on Neon', createdAt: Date.now(), timezone: 'UTC' })
          .returning()
        const hits = await db.all(sql`select rowid as id from messages_fts where messages_fts match ${'postgres'} order by rowid desc limit 1`)
        await db.delete(schema.conversations).where(sql`id = ${id}`)
        return Response.json({ ok: true, inserted: msg, ftsHits: hits })
      },
    },
  },
})
