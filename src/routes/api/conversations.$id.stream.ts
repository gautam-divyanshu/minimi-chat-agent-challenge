import { createFileRoute } from '@tanstack/react-router'
import { turnStream } from '#/server/agent/turns'

// Reattach to a running turn: replays its events so far, then follows it live.
// 204 when nothing is running for this conversation.
export const Route = createFileRoute('/api/conversations/$id/stream')({
  server: { handlers: { GET: async ({ params }) => turnStream(params.id) ?? new Response(null, { status: 204 }) } },
})
