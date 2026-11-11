import { createFileRoute } from '@tanstack/react-router'
import { listConversations } from '#/server/conversations'

export const Route = createFileRoute('/api/conversations')({
  server: { handlers: { GET: async () => Response.json(await listConversations()) } },
})
