import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Rule: everything we query is a real column. Only tool input/output is JSON.
// Timestamps are UTC milliseconds (integers).

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title'),
  createdAt: integer('created_at').notNull(),
})

export const messages = sqliteTable(
  'messages',
  {
    // Integer rowid so the FTS5 index can point at it (content_rowid).
    id: integer('id').primaryKey({ autoIncrement: true }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    text: text('text').notNull(),
    createdAt: integer('created_at').notNull(),
    timezone: text('timezone').notNull(),
    // streaming: being written now. interrupted: the server stopped mid-answer.
    status: text('status', { enum: ['done', 'streaming', 'stopped', 'interrupted', 'error'] })
      .notNull()
      .default('done'),
  },
  (t) => [
    index('messages_conversation_idx').on(t.conversationId, t.createdAt),
    index('messages_created_idx').on(t.createdAt),
  ],
)

export const toolEvents = sqliteTable(
  'tool_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    messageId: integer('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    tool: text('tool').notNull(),
    input: text('input', { mode: 'json' }).notNull(),
    output: text('output', { mode: 'json' }),
    startedAt: integer('started_at').notNull(),
    durationMs: integer('duration_ms'),
  },
  (t) => [index('tool_events_message_idx').on(t.messageId)],
)

export type Conversation = typeof conversations.$inferSelect
export type Message = typeof messages.$inferSelect
export type ToolEvent = typeof toolEvents.$inferSelect
