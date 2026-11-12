import { withReport } from './report'
import {
  argsCorrect,
  attribution,
  brevity,
  citations,
  cleanOutput,
  llmJudge,
  mentions,
  minCallsMet,
  toolOrderCorrect,
  toolsAvoided,
} from './evaluators'
import type { MultiTurnData, MultiTurnResult, MultiTurnTarget } from './types'

type Scorer = (output: MultiTurnResult, target?: MultiTurnTarget, data?: MultiTurnData) => number | Promise<number>

/** The scorers for full-turn evals, shared by every dataset that runs through the harness. */
export const agentScorers = (group: string) =>
  withReport<Record<string, Scorer>>(group, {
    toolOrder: (output, target) => toolOrderCorrect(output, target ?? { rubric: '' }),
    toolsAvoided: (output, target) => toolsAvoided(output, target ?? {}),
    argsCorrect: (output, target) => argsCorrect(output, target?.args),
    parallelCalls: (output, target) => minCallsMet(output, target?.minCalls),
    mentions: (output, target) => mentions(output, target!),
    citations: (output, target) => citations(output, target!),
    attribution: (output, target) => attribution(output, target!),
    cleanOutput: (output) => cleanOutput(output),
    brevity: (output, target) => brevity(output, target!),
    judge: (output, target, data) => llmJudge(output, target!, data!),
    // Not 0..1: seconds, to watch speed alongside quality.
    firstTextSeconds: (output) => output.firstTextSeconds,
    totalSeconds: (output) => output.seconds,
  })
