import type { z } from 'zod'
import type { Source } from '#/shared/events'

/**
 * A tool the harness runs itself. The model only ever sees name, description
 * and input schema; execution, timeouts and error handling live in loop.ts.
 */
export interface AgentTool<I = any, O = any> {
  name: string
  description: string
  inputSchema: z.ZodType<I>
  /** Hard limit; on expiry the model gets `{ error: "timeout" }`. */
  timeoutMs: number
  /**
   * Harness-side correction of the model's input before it runs (e.g. apply the
   * user's date window). The corrected input is what gets shown, run and saved.
   */
  refineInput?(input: I): I
  execute(input: I, ctx: { signal: AbortSignal }): Promise<O>
  /** Pull citable sources out of the output, for the UI's source chips. */
  sources?(output: O): Source[]
}

export function defineTool<I, O>(tool: AgentTool<I, O>): AgentTool<I, O> {
  return tool
}
