import { generateText, Output } from 'ai'
import { z } from 'zod'
import { getModel } from '../src/server/agent/model'
import type { ArgCheck, MultiTurnData, MultiTurnResult, MultiTurnTarget, ToolCall } from './types'
import { EVAL_NOW } from './executors'

// Scorers return 0..1. Names and behaviour follow the agents-v2 course
// (toolsSelected, toolsAvoided, toolSelectionScore, toolOrderCorrect, llmJudge),
// plus checks for this agent's known failure modes.

type ToolTarget = { expectedTools?: string[]; forbiddenTools?: string[] }

/** Golden: did it select ALL expected tools? */
export function toolsSelected(output: { toolNames: string[] }, target: ToolTarget): number {
  const expected = target.expectedTools ?? []
  return expected.every((t) => output.toolNames.includes(t)) ? 1 : 0
}

/** Negative: did it avoid ALL forbidden tools? */
export function toolsAvoided(output: { toolNames: string[] }, target: ToolTarget): number {
  const forbidden = target.forbiddenTools ?? []
  return forbidden.some((t) => output.toolNames.includes(t)) ? 0 : 1
}

/** Secondary: F1 of selected vs expected tools (partial credit). */
export function toolSelectionScore(output: { toolNames: string[] }, target: ToolTarget): number {
  const expected = new Set(target.expectedTools ?? [])
  const selected = new Set(output.toolNames)
  if (expected.size === 0) return selected.size === 0 ? 1 : 0
  const hits = [...selected].filter((t) => expected.has(t)).length
  if (hits === 0) return 0
  const precision = hits / selected.size
  const recall = hits / expected.size
  return (2 * precision * recall) / (precision + recall)
}

/** Did the expected tools run in order? Other calls may come in between. */
export function toolOrderCorrect(output: { toolNames: string[] }, target: { expectedToolOrder?: string[] }): number {
  const expected = target.expectedToolOrder ?? []
  let i = 0
  for (const name of output.toolNames) if (name === expected[i]) i++
  return i === expected.length ? 1 : 0
}

/** Fraction of argument checks that pass. A check passes if ANY call to that tool satisfies it (all calls, for `absent`). */
export function argsCorrect(output: { toolCalls: ToolCall[] }, checks: ArgCheck[] = []): number {
  if (checks.length === 0) return 1
  const passed = checks.filter((c) => {
    const calls = output.toolCalls.filter((t) => t.toolName === c.tool)
    if (c.absent) return calls.every((t) => t.args[c.arg] == null || t.args[c.arg] === '')
    return calls.some((t) => {
      const v = String(t.args[c.arg] ?? '')
      if (c.equals !== undefined) return v === c.equals
      if (c.oneOf) return c.oneOf.includes(v)
      if (c.contains !== undefined) return v.toLowerCase().includes(c.contains.toLowerCase())
      return false
    })
  })
  return passed.length / checks.length
}

export function minCallsMet(output: { toolNames: string[] }, min?: { tool: string; count: number }): number {
  if (!min) return 1
  return output.toolNames.filter((t) => t === min.tool).length >= min.count ? 1 : 0
}

// --- checks on the final answer ----------------------------------------------

const linkedUrls = (text: string) => [...text.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)].map((m) => m[1])
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Fraction of mustMention patterns found; 0 if any mustNotMention pattern is found. */
export function mentions(output: MultiTurnResult, target: MultiTurnTarget): number {
  const has = (p: string) => new RegExp(p, 'i').test(output.answer)
  if ((target.mustNotMention ?? []).some(has)) return 0
  const must = target.mustMention ?? []
  return must.length === 0 ? 1 : must.filter(has).length / must.length
}

/**
 * Citations are honest: every linked URL was actually returned by a tool in
 * this run (no invented links), required domains are cited, banned ones are not.
 */
export function citations(output: MultiTurnResult, target: MultiTurnTarget): number {
  const cited = linkedUrls(output.answer)
  const returned = new Set(output.returnedUrls.map((u) => u.replace(/\/$/, '')))
  if (cited.some((u) => !returned.has(u.replace(/\/$/, '')))) return 0
  const citedHosts = new Set(cited.map(host))
  if ((target.mustNotCite ?? []).some((d) => citedHosts.has(d))) return 0
  const must = target.mustCite ?? []
  return must.length === 0 ? 1 : must.filter((d) => citedHosts.has(d)).length / must.length
}

/** Short enough, and no more code blocks than asked for. 1 when the case sets no limit. */
export function brevity(output: MultiTurnResult, target: MultiTurnTarget): number {
  const words = output.answer.trim().split(/\s+/).filter(Boolean).length
  if (target.maxWords !== undefined && words > target.maxWords) return 0
  const fences = (output.answer.match(/^\s*```/gm) ?? []).length / 2
  if (target.maxFences !== undefined && fences > target.maxFences) return 0
  return 1
}

/** A number is cited to the page it came from: every line stating it links the right domain. */
export function attribution(output: MultiTurnResult, target: MultiTurnTarget): number {
  for (const rule of target.attribution ?? []) {
    const lines = output.answer.split('\n').filter((l) => new RegExp(rule.value).test(l))
    if (lines.some((l) => !linkedUrls(l).map(host).includes(rule.domain))) return 0
  }
  return 1
}

/** No malformed links, and no date later than "today" in the eval clock. */
export function cleanOutput(output: MultiTurnResult): number {
  if (/\]\(https?:\/\/[^)]*\s[^)]*\)/.test(output.answer)) return 0
  const today = new Date(EVAL_NOW).toISOString().slice(0, 10)
  const isoDates = [...output.answer.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((m) => m[1])
  const months = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec'
  const written = [
    ...output.answer.matchAll(new RegExp(`\\b(${months})[a-z]*\\.? (\\d{1,2}),? (20\\d{2})\\b`, 'gi')),
  ].map((m) => `${m[3]}-${String(months.split('|').indexOf(m[1].toLowerCase().slice(0, 3)) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`)
  return [...isoDates, ...written].some((d) => d > today) ? 0 : 1
}

// --- LLM judge ------------------------------------------------------------------

/** The judge's explanation per answer, for the terminal report. */
export const judgeReasons = new Map<string, string>()

const judgeSchema = z.object({
  score: z.number().min(1).max(10),
  reason: z.string(),
})

/**
 * LLM-as-judge with structured output and a fixed rubric (course lesson 5).
 * Same model as the agent, at high reasoning effort. Returns score/10.
 */
export async function llmJudge(output: MultiTurnResult, target: MultiTurnTarget, data: MultiTurnData): Promise<number> {
  const { output: verdict } = await generateText({
    model: getModel(),
    providerOptions: { openai: { reasoningEffort: 'high' } },
    output: Output.object({ schema: judgeSchema }),
    system: `You grade answers from a research assistant that has two tools: web_search and recall_history (its record of past conversations with this user).
Today is ${new Date(EVAL_NOW).toDateString()}. When there are several user messages, the FINAL ANSWER replies to the LAST one; earlier messages are context and need not be answered again. The tool results below are the ONLY facts available; they are test fixtures, so treat them as true even if they differ from what you know.

Score 1-10:
10: does exactly what the rubric describes; every number and claim matches the tool results and is attributed to the right source
7-9: correct, with minor issues (wording, a missing secondary detail)
4-6: partly correct; misses a required element, or includes a claim the tool results do not support
1-3: wrong, invents facts or past conversations, or contradicts the tool results`,
    prompt: `${data.prompts.length > 1 ? `EARLIER IN THE CONVERSATION (context only, already answered):\n${data.prompts.slice(0, -1).join('\n')}\n\n` : ''}USER MESSAGE BEING ANSWERED:\n${data.prompts.at(-1)}

TOOLS CALLED (in order): ${output.toolNames.join(', ') || 'none'}

TOOL RESULTS:\n${output.toolResults || '(none)'}

FINAL ANSWER:\n${output.answer}

RUBRIC (what a correct answer does):\n${target.rubric}`,
  })
  judgeReasons.set(output.answer, verdict.reason)
  return verdict.score / 10
}
