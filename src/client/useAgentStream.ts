import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentEvent, Source } from '#/shared/events'

// Client half of the SSE protocol. The server owns the turn: this hook only
// watches it. On load it fetches the conversation, and if an answer is still
// being written (the page was refreshed mid-answer) it reattaches to the
// running turn, which replays the events so far and then continues live.

export type ToolCallState = {
  callId: string
  tool: string
  input: any
  status: 'running' | 'done'
  sources: Source[]
  error?: string
  durationMs?: number
}

export type ChatMessage = {
  key: string
  role: 'user' | 'assistant'
  text: string
  tools: ToolCallState[]
  /** interrupted: the server stopped while this answer was being written. */
  status: 'streaming' | 'done' | 'error' | 'interrupted'
  error?: string
}

type Options = {
  conversationId?: string
  /** A new chat got its id from the server (first event of its first turn). */
  onCreated?: (id: string) => void
  onTurnDone?: () => void
}

const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

async function fetchMessages(conversationId: string): Promise<ChatMessage[]> {
  const res = await fetch(`/api/conversations/${conversationId}`)
  if (!res.ok) return []
  const conv = await res.json()
  return conv.messages.map((m: any) => ({
    key: String(m.id),
    role: m.role,
    text: m.text,
    status: m.status === 'streaming' || m.status === 'interrupted' ? m.status : 'done',
    tools: m.tools.map((t: any, i: number) => ({ ...t, callId: `${m.id}-${i}`, status: 'done' })),
  }))
}

export function useAgentStream({ conversationId, onCreated, onTurnDone }: Options) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const idRef = useRef(conversationId)
  const abortRef = useRef<AbortController | null>(null)
  const callbacks = useRef({ onCreated, onTurnDone })
  callbacks.current = { onCreated, onTurnDone }

  /** Read an event stream into the message with this key until it ends. */
  const watch = useCallback(async (start: (signal: AbortSignal) => Promise<Response>, key: string) => {
    const update = (fn: (m: ChatMessage) => ChatMessage) => setMessages((all) => all.map((m) => (m.key === key ? fn(m) : m)))
    const abort = new AbortController()
    abortRef.current?.abort()
    abortRef.current = abort
    setStreaming(true)
    try {
      const res = await start(abort.signal)
      if (res.status === 204) return 'nothing-running' as const
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`)

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += value
        const frames = buffer.split('\n\n')
        buffer = frames.pop()!
        const events = frames.filter((f) => f.startsWith('data: ')).map((f) => JSON.parse(f.slice(6)) as AgentEvent)
        // One state update per network chunk, however many events it holds.
        update((m) => events.reduce(apply, m))
        for (const e of events) {
          if (e.type === 'turn_started' && !idRef.current) {
            idRef.current = e.conversationId
            callbacks.current.onCreated?.(e.conversationId)
          }
        }
      }
      update((m) => (m.status === 'streaming' ? { ...m, status: 'done' } : m))
    } catch (err) {
      // Aborted locally = we navigated away; the turn carries on server-side.
      if (!abort.signal.aborted) update((m) => ({ ...m, status: 'error', error: err instanceof Error ? err.message : String(err) }))
    } finally {
      if (abortRef.current === abort) {
        abortRef.current = null
        setStreaming(false)
      }
      if (!abort.signal.aborted) callbacks.current.onTurnDone?.()
    }
    return 'ended' as const
  }, [])

  // Load history when the conversation changes, unless we just created it.
  useEffect(() => {
    if (conversationId === idRef.current && messages.length) return
    idRef.current = conversationId
    abortRef.current?.abort()
    setStreaming(false)
    if (!conversationId) return setMessages([])
    let cancelled = false
    setLoading(true)
    void (async () => {
      let loaded = await fetchMessages(conversationId)
      if (cancelled) return
      const last = loaded.at(-1)
      const resume = last?.role === 'assistant' && last.status === 'streaming' ? last.key : undefined
      // The replay starts from the turn's first event, so start that message empty.
      if (resume) loaded = loaded.map((m) => (m.key === resume ? { ...m, text: '', tools: [] } : m))
      setMessages(loaded)
      setLoading(false)
      if (!resume) return
      const outcome = await watch((signal) => fetch(`/api/conversations/${conversationId}/stream`, { signal }), resume)
      // It finished between the two requests: show the saved result.
      if (outcome === 'nothing-running' && !cancelled) setMessages(await fetchMessages(conversationId))
    })().finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  // Leaving the page stops watching, never the turn.
  useEffect(() => () => abortRef.current?.abort(), [])

  const send = useCallback(
    async (text: string) => {
      const key = crypto.randomUUID()
      setMessages((m) => [
        ...m,
        { key: `${key}-u`, role: 'user', text, tools: [], status: 'done' },
        { key: `${key}-a`, role: 'assistant', text: '', tools: [], status: 'streaming' },
      ])
      await watch(
        (signal) =>
          fetch('/api/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ conversationId: idRef.current, text, timezone: timezone() }),
            signal,
          }),
        `${key}-a`,
      )
    },
    [watch],
  )

  /** Stop the turn on the server. The partial answer is kept; the stream then ends by itself. */
  const stop = useCallback(() => {
    if (idRef.current) void fetch(`/api/conversations/${idRef.current}/stop`, { method: 'POST' }).catch(() => {})
    else abortRef.current?.abort()
  }, [])

  return { messages, loading, streaming, send, stop }
}

function apply(m: ChatMessage, e: AgentEvent): ChatMessage {
  switch (e.type) {
    case 'text_delta':
      return { ...m, text: m.text + e.text }
    case 'tool_started':
      return { ...m, tools: [...m.tools, { callId: e.callId, tool: e.tool, input: e.input, status: 'running', sources: [] }] }
    case 'tool_finished':
      return {
        ...m,
        tools: m.tools.map((t) =>
          t.callId === e.callId ? { ...t, status: 'done', sources: e.sources, error: e.error, durationMs: e.durationMs } : t,
        ),
      }
    case 'error':
      return { ...m, status: 'error', error: e.message }
    case 'turn_done':
      return { ...m, status: m.status === 'error' ? 'error' : 'done' }
    default:
      return m
  }
}
