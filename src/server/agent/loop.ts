import { streamText, tool as sdkTool, type LanguageModel, type ModelMessage, type ToolSet } from 'ai'
import type { AgentEvent } from '#/shared/events'
import type { AgentTool } from './tool'

/**
 * The agent loop. The AI SDK is used for one thing: a single streamed model
 * call per step. Tools are declared to the model WITHOUT `execute`, so the SDK
 * never runs them; this loop does, which is where the step cap, parallelism,
 * timeouts, error-as-result and event emission live. Every step is visible here.
 */

export type ToolEvent = AgentEvent & { type: 'tool_started' | 'tool_finished' }

export type ToolRun = {
  callId: string
  tool: string
  input: unknown
  output: unknown
  startedAt: number
  durationMs: number
  error?: string
}

export type StepStat = {
  /** Wall time of the model call, and time until its first streamed part. */
  ms: number
  firstPartMs: number
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  toolCalls: number
}

export type LoopOptions = {
  model: LanguageModel
  /** Provider settings, e.g. { openai: { reasoningEffort: 'low' } }. */
  providerOptions?: Record<string, Record<string, any>>
  system: string
  messages: ModelMessage[]
  tools: AgentTool[]
  /** Model calls per turn. The last one is forced to answer (no tools). */
  maxSteps?: number
  onEvent: (event: AgentEvent) => void
  /** Called as each tool finishes, with full input/output (for persistence). */
  onToolRun?: (run: ToolRun) => void
  signal?: AbortSignal
}

export type LoopResult = {
  text: string
  toolRuns: ToolRun[]
  steps: number
  stepStats: StepStat[]
  /** Conversation including this turn's assistant + tool messages. */
  messages: ModelMessage[]
}

export async function runAgentLoop(opts: LoopOptions): Promise<LoopResult> {
  const { model, system, tools, onEvent, signal } = opts
  const maxSteps = opts.maxSteps ?? 6
  const byName = new Map(tools.map((t) => [t.name, t]))
  const sdkTools: ToolSet = Object.fromEntries(
    tools.map((t) => [t.name, sdkTool({ description: t.description, inputSchema: t.inputSchema })]),
  )

  const messages = [...opts.messages]
  const toolRuns: ToolRun[] = []
  const stepStats: StepStat[] = []
  let text = ''

  for (let step = 0; step < maxSteps; step++) {
    const lastStep = step === maxSteps - 1
    const result = streamText({
      model,
      system,
      messages,
      tools: sdkTools,
      // On the final step the model must answer with what it has.
      toolChoice: lastStep ? 'none' : 'auto',
      providerOptions: opts.providerOptions,
      abortSignal: signal,
      maxRetries: 1,
    })
    const stepStart = Date.now()
    const stat: StepStat = { ms: 0, firstPartMs: 0, toolCalls: 0 }

    const calls: { callId: string; tool: string; input: unknown; invalid?: string }[] = []
    let stepText = ''
    for await (const part of result.stream) {
      if (!stat.firstPartMs && (part.type === 'text-delta' || part.type === 'tool-call')) stat.firstPartMs = Date.now() - stepStart
      switch (part.type) {
        case 'text-delta': {
          // Separate this step's text from earlier steps' ("Let me check…").
          const delta = stepText === '' && text !== '' ? `\n\n${part.text}` : part.text
          stepText += part.text
          text += delta
          onEvent({ type: 'text_delta', text: delta })
          break
        }
        case 'tool-call':
          calls.push({
            callId: part.toolCallId,
            tool: part.toolName,
            input: part.input,
            invalid: part.invalid ? errorMessage(part.error) : undefined,
          })
          break
        case 'finish-step':
          stat.inputTokens = part.usage.inputTokens
          stat.outputTokens = part.usage.outputTokens
          stat.reasoningTokens = part.usage.outputTokenDetails?.reasoningTokens
          break
        case 'error':
          throw part.error
      }
    }
    stat.ms = Date.now() - stepStart
    stat.toolCalls = calls.length
    stepStats.push(stat)

    const responseMessages = await result.responseMessages
    messages.push(...responseMessages)
    if (calls.length === 0) return { text, toolRuns, steps: step + 1, stepStats, messages }

    // Independent tool calls run in parallel (e.g. 5 CRM tools → 5 searches at once).
    const runs = await Promise.all(
      calls.map(async (c) => {
        const run = await runTool(c, byName.get(c.tool), onEvent, signal)
        opts.onToolRun?.(run)
        return run
      }),
    )
    toolRuns.push(...runs)

    // The SDK already answers invalid calls (unknown tool, unparseable input)
    // with its own error result; a second result for the same id is rejected.
    const answered = new Set(
      responseMessages.flatMap((m) =>
        m.role === 'tool' ? m.content.flatMap((p) => (p.type === 'tool-result' ? [p.toolCallId] : [])) : [],
      ),
    )
    const pending = runs.filter((r) => !answered.has(r.callId))
    if (pending.length === 0) continue
    messages.push({
      role: 'tool',
      content: pending.map((r) => ({
        type: 'tool-result' as const,
        toolCallId: r.callId,
        toolName: r.tool,
        output: { type: 'json' as const, value: (r.error ? { error: r.error } : r.output) as any },
      })),
    })
  }

  // Unreachable: the last step has toolChoice 'none', so it returns above.
  return { text, toolRuns, steps: maxSteps, stepStats, messages }
}

async function runTool(
  call: { callId: string; tool: string; input: unknown; invalid?: string },
  tool: AgentTool | undefined,
  onEvent: (e: AgentEvent) => void,
  parentSignal?: AbortSignal,
): Promise<ToolRun> {
  const startedAt = Date.now()
  onEvent({ type: 'tool_started', callId: call.callId, tool: call.tool, input: call.input })

  let output: unknown = null
  let error: string | undefined
  if (!tool) error = `unknown tool: ${call.tool}`
  else if (call.invalid) error = `invalid input: ${call.invalid}`
  else {
    const parsed = tool.inputSchema.safeParse(call.input)
    if (!parsed.success) error = `invalid input: ${parsed.error.message}`
    else {
      const timeout = AbortSignal.timeout(tool.timeoutMs)
      const signal = parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout
      try {
        output = await raceAbort(tool.execute(parsed.data, { signal }), signal)
      } catch (err) {
        // Errors become tool results the model can reason about; never thrown.
        error = timeout.aborted ? 'timeout' : errorMessage(err)
      }
    }
  }

  const durationMs = Date.now() - startedAt
  const sources = !error && tool?.sources ? safe(() => tool.sources!(output)) ?? [] : []
  onEvent({ type: 'tool_finished', callId: call.callId, tool: call.tool, sources, durationMs, error })
  return { callId: call.callId, tool: call.tool, input: call.input, output, startedAt, durationMs, error }
}

/** Resolve with the promise, or reject as soon as the signal aborts (even if the tool ignores it). */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch {
    return undefined
  }
}
