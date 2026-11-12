import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { startTurn, turnStream } from '#/server/agent/turns'

const Body = z.object({
  conversationId: z.string().min(1).max(64).optional(),
  text: z.string().trim().min(1).max(8000),
  timezone: z.string().max(64).default('UTC'),
})

// POST /api/chat → starts a turn and streams it as Server-Sent Events, one
// `data:` line per AgentEvent. The turn is owned by the server: if this
// response is cut off (refresh, closed tab), the turn keeps running and
// GET /api/conversations/:id/stream picks it up again.
export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'bad request' }, { status: 400 })
        const { text, timezone } = parsed.data
        const conversationId = parsed.data.conversationId ?? crypto.randomUUID()

        if (!startTurn({ conversationId, text, timezone })) {
          return Response.json({ error: 'This conversation is still answering the previous message.' }, { status: 409 })
        }
        return turnStream(conversationId) ?? new Response(null, { status: 204 })
      },
    },
  },
})
