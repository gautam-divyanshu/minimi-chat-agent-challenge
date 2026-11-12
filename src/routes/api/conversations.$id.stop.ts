import { createFileRoute } from '@tanstack/react-router'
import { stopTurn } from '#/server/agent/turns'

// The Stop button. The only thing that cancels a turn; the partial answer is kept.
export const Route = createFileRoute('/api/conversations/$id/stop')({
  server: { handlers: { POST: async ({ params }) => Response.json({ stopped: stopTurn(params.id) }) } },
})
