import { evaluate } from '@lmnr-ai/lmnr'
import { withReport } from './report'
import dataset from './data/multi-turn.json'
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
import { multiTurn } from './executors'
import type { MultiTurnData, MultiTurnTarget } from './types'

/**
 * Multi-turn agent evaluation (agents-v2 lesson 5).
 * Full chat turns through the real harness on a seeded in-memory database,
 * with a fixed clock and a fake search engine serving fixture pages, so runs
 * are repeatable and cost no Exa calls. Covers the three questions from the
 * brief plus the failures found while building (see data/multi-turn.json).
 *
 * Code scorers check behaviour; the LLM judge checks the answer against a rubric.
 */
evaluate({
  data: dataset as { data: MultiTurnData; target: MultiTurnTarget }[],
  executor: multiTurn,
  evaluators: withReport('multi-turn', {
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
  }),
  groupName: 'multi-turn',
  config: { projectApiKey: process.env.LMNR_PROJECT_API_KEY },
})
