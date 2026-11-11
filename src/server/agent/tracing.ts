/**
 * Tracing with Laminar (OpenTelemetry). Optional: without LMNR_PROJECT_API_KEY
 * everything here is a no-op and the SDK is never loaded, so the chat runs on
 * the OpenAI and Exa keys alone.
 *
 * A trace of one chat turn looks like:
 *   chat.turn                      (session = conversation id)
 *   ├─ model call                  (prompt, output, tokens: from the AI SDK)
 *   ├─ web_search / recall_history (our tool runs; the SDK never executes them)
 *   └─ model call
 */

export type SpanOptions = {
  name: string
  input?: unknown
  sessionId?: string
  spanType?: 'DEFAULT' | 'TOOL'
  metadata?: Record<string, string | number | boolean>
}

export type Tracing = {
  enabled: boolean
  /** Passed to streamText so each model call becomes a span. */
  telemetry: { isEnabled: boolean; functionId?: string; integrations?: any } | undefined
  /** Run fn inside a span; nested model calls and spans attach to it. */
  span<T>(options: SpanOptions, fn: () => Promise<T>): Promise<T>
  /** Send buffered spans now. Needed in short-lived processes (tests, evals). */
  flush(): Promise<void>
}

export const noTracing: Tracing = {
  enabled: false,
  telemetry: undefined,
  span: (_options, fn) => fn(),
  flush: async () => {},
}

let tracing: Promise<Tracing> | undefined

export function getTracing(): Promise<Tracing> {
  tracing ??= init().catch((err) => {
    console.warn('Laminar tracing disabled:', err instanceof Error ? err.message : err)
    return noTracing
  })
  return tracing
}

async function init(): Promise<Tracing> {
  const projectApiKey = process.env.LMNR_PROJECT_API_KEY?.trim()
  if (!projectApiKey) return noTracing

  const { Laminar, aiSdkTelemetry, observe } = await import('@lmnr-ai/lmnr')
  // instrumentModules: {} → no auto-patching of other libraries; we only want
  // the spans we create and the AI SDK's own telemetry events.
  if (!Laminar.initialized()) Laminar.initialize({ projectApiKey, instrumentModules: {} })
  const integration = aiSdkTelemetry()

  return {
    enabled: true,
    telemetry: { isEnabled: true, functionId: 'agent-step', integrations: integration },
    span: (options, fn) => observe(options, fn),
    flush: () => Laminar.flush(),
  }
}
