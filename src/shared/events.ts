// SSE event protocol, shared by the server harness and the browser hook.

export type Source = {
  title: string
  url: string
  /** ISO date if the page has one. */
  publishedAt?: string
}

export type AgentEvent =
  | { type: 'turn_started'; conversationId: string }
  | { type: 'tool_started'; callId: string; tool: string; input: unknown }
  | {
      type: 'tool_finished'
      callId: string
      tool: string
      sources: Source[]
      durationMs: number
      error?: string
    }
  | { type: 'text_delta'; text: string }
  | { type: 'turn_done'; messageId: number }
  | { type: 'error'; message: string }
