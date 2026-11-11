import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { runTurn } from '#/server/agent/harness'
import type { AgentEvent } from '#/shared/events'

const Body = z.object({
  conversationId: z.string().min(1).max(64).optional(),
  text: z.string().trim().min(1).max(8000),
  timezone: z.string().max(64).default('UTC'),
})

// POST /api/chat → Server-Sent Events, one `data:` line per AgentEvent.
// The turn keeps running if the client disconnects: it's persisted either way.
export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'bad request' }, { status: 400 })
        const { text, timezone } = parsed.data
        const conversationId = parsed.data.conversationId ?? crypto.randomUUID()

        const encoder = new TextEncoder()
        let closed = false
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const emit = (e: AgentEvent) => {
              if (closed) return
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))
              } catch {
                closed = true // client went away; keep running, the DB has it all
              }
            }
            runTurn({ conversationId, text, timezone, emit })
              .catch((err) => emit({ type: 'error', message: err instanceof Error ? err.message : String(err) }))
              .finally(() => {
                if (!closed) controller.close()
                closed = true
              })
          },
          cancel() {
            closed = true
          },
        })

        return new Response(body, {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        })
      },
    },
  },
})
