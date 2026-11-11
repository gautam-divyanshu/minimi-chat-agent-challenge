import { createFileRoute } from '@tanstack/react-router'
import { getConversation } from '#/server/conversations'

export const Route = createFileRoute('/api/conversations/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const conv = await getConversation(params.id)
        return conv ? Response.json(conv) : Response.json({ error: 'not found' }, { status: 404 })
      },
    },
  },
})
