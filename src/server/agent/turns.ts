import type { AgentEvent } from '../../shared/events'
import { runTurn, type TurnInput } from './harness'

/**
 * Running turns, kept apart from the HTTP request that started them.
 *
 * A turn belongs to the server, not to a browser tab: closing or refreshing
 * the page does not cancel it. Each running turn keeps its events in memory,
 * so a page that loads mid-answer can replay what it missed and then follow
 * the rest live. Only an explicit stop() aborts a turn.
 *
 * (Durable across a server restart it is not: that is what the `interrupted`
 * status is for. Checkpoint-and-resume would need a workflow engine.)
 */

type LiveTurn = {
  events: AgentEvent[]
  listeners: Set<(event: AgentEvent) => void>
  abort: AbortController
  done: Promise<void>
}

// One per conversation; survives Vite dev-server module reloads.
const g = globalThis as typeof globalThis & { __liveTurns?: Map<string, LiveTurn> }
const live = (g.__liveTurns ??= new Map())

export function isRunning(conversationId: string): boolean {
  return live.has(conversationId)
}

/** Start a turn. Returns false if this conversation already has one running. */
export function startTurn(input: Omit<TurnInput, 'emit' | 'signal'>): boolean {
  const id = input.conversationId
  if (live.has(id)) return false
  const abort = new AbortController()
  const turn: LiveTurn = { events: [], listeners: new Set(), abort, done: Promise.resolve() }
  const emit = (event: AgentEvent) => {
    turn.events.push(event)
    for (const listener of turn.listeners) listener(event)
  }
  live.set(id, turn)
  turn.done = runTurn({ ...input, emit, signal: abort.signal })
    .then(() => {})
    .catch((err) => emit({ type: 'error', message: err instanceof Error ? err.message : String(err) }))
    .finally(() => {
      live.delete(id)
      for (const listener of turn.listeners) listener(END)
    })
  return true
}

/** Sent to listeners after the last event, so streams know to close. */
const END = { type: 'end' } as unknown as AgentEvent

/**
 * Follow a running turn from the beginning: every event so far is replayed,
 * then new ones arrive as they happen. `onEnd` fires once the turn is over.
 * Returns an unsubscribe function, or null if nothing is running.
 */
export function followTurn(conversationId: string, onEvent: (event: AgentEvent) => void, onEnd: () => void): (() => void) | null {
  const turn = live.get(conversationId)
  if (!turn) return null
  const listener = (event: AgentEvent) => (event === END ? onEnd() : onEvent(event))
  for (const event of turn.events) onEvent(event)
  turn.listeners.add(listener)
  return () => turn.listeners.delete(listener)
}

/** The user pressed Stop. The partial answer is kept. */
export function stopTurn(conversationId: string): boolean {
  const turn = live.get(conversationId)
  turn?.abort.abort()
  return Boolean(turn)
}

/** For tests: wait until a conversation's turn has finished. */
export function turnFinished(conversationId: string): Promise<void> {
  return live.get(conversationId)?.done ?? Promise.resolve()
}

/** An SSE response that replays and follows a running turn. */
export function turnStream(conversationId: string): Response | null {
  if (!live.has(conversationId)) return null
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true
      const close = () => {
        if (!open) return
        open = false
        unsubscribe?.()
        try {
          controller.close()
        } catch {}
      }
      unsubscribe = followTurn(
        conversationId,
        (event) => {
          if (!open) return
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch {
            close() // the browser went away; the turn itself carries on
          }
        },
        close,
      )
      if (!unsubscribe) close()
    },
    cancel() {
      unsubscribe?.()
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
}
