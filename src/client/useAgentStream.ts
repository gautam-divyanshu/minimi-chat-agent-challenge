import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentEvent, Source } from '#/shared/events'

// Client half of the SSE protocol: sends a message, reads typed events, and
// keeps message state. The server is the source of truth: on load (or after
// switching chats) we fetch the conversation; during a turn we apply events.

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
  status: 'streaming' | 'done' | 'error'
  error?: string
}

type Options = {
  conversationId?: string
  /** A new chat got its id from the server (first event of its first turn). */
  onCreated?: (id: string) => void
  onTurnDone?: () => void
}

const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

export function useAgentStream({ conversationId, onCreated, onTurnDone }: Options) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const idRef = useRef(conversationId)
  const abortRef = useRef<AbortController | null>(null)

  // Load history when the conversation changes, unless we just created it.
  useEffect(() => {
    if (conversationId === idRef.current && messages.length) return
    idRef.current = conversationId
    abortRef.current?.abort()
    setStreaming(false)
    if (!conversationId) return setMessages([])
    let cancelled = false
    setLoading(true)
    fetch(`/api/conversations/${conversationId}`)
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((conv) => {
        if (cancelled) return
        setMessages(
          conv.messages.map((m: any) => ({
            key: String(m.id),
            role: m.role,
            text: m.text,
            status: 'done',
            tools: m.tools.map((t: any, i: number) => ({ ...t, callId: `${m.id}-${i}`, status: 'done' })),
          })),
        )
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  const send = useCallback(
    async (text: string) => {
      const key = crypto.randomUUID()
      setMessages((m) => [
        ...m,
        { key: `${key}-u`, role: 'user', text, tools: [], status: 'done' },
        { key: `${key}-a`, role: 'assistant', text: '', tools: [], status: 'streaming' },
      ])
      setStreaming(true)
      const updateAssistant = (fn: (m: ChatMessage) => ChatMessage) =>
        setMessages((all) => all.map((m) => (m.key === `${key}-a` ? fn(m) : m)))

      const abort = new AbortController()
      abortRef.current = abort
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ conversationId: idRef.current, text, timezone: timezone() }),
          signal: abort.signal,
        })
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
          updateAssistant((m) => events.reduce(apply, m))
          for (const e of events) {
            if (e.type === 'turn_started' && !idRef.current) {
              idRef.current = e.conversationId
              onCreated?.(e.conversationId)
            }
          }
        }
        updateAssistant((m) => (m.status === 'streaming' ? { ...m, status: 'done' } : m))
      } catch (err) {
        if (abort.signal.aborted) updateAssistant((m) => ({ ...m, status: 'done' }))
        else updateAssistant((m) => ({ ...m, status: 'error', error: err instanceof Error ? err.message : String(err) }))
      } finally {
        if (abortRef.current === abort) abortRef.current = null
        setStreaming(false)
        onTurnDone?.()
      }
    },
    [onCreated, onTurnDone],
  )

  /** Stop watching. The server finishes and saves the turn anyway. */
  const stop = useCallback(() => abortRef.current?.abort(), [])

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
