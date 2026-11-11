import { evaluate } from '@lmnr-ai/lmnr'
import { withReport } from './report'
import dataset from './data/tool-selection.json'
import { argsCorrect, minCallsMet, toolSelectionScore, toolsAvoided, toolsSelected } from './evaluators'
import { singleTurn } from './executors'
import type { SingleTurnData, SingleTurnTarget } from './types'

/**
 * Single-turn tool selection (agents-v2 lesson 3).
 * One model call per case with the real system prompt and tool schemas; tools
 * are not executed. Categories:
 * - golden: must select the expected tools (with the right arguments)
 * - secondary: likely selects them; scored by F1
 * - negative: must NOT select the forbidden tools
 * Each scorer returns 1 for cases it does not apply to.
 */
evaluate({
  data: dataset as { data: SingleTurnData; target: SingleTurnTarget }[],
  executor: singleTurn,
  evaluators: withReport('tool-selection', {
    toolsSelected: (output, target) => (target?.category === 'golden' ? toolsSelected(output, target) : 1),
    toolsAvoided: (output, target) => (target?.forbiddenTools ? toolsAvoided(output, target) : 1),
    selectionScore: (output, target) => (target?.category === 'secondary' ? toolSelectionScore(output, target) : 1),
    argsCorrect: (output, target) => argsCorrect(output, target?.args),
    parallelCalls: (output, target) => minCallsMet(output, target?.minCalls),
  }),
  groupName: 'tool-selection',
  config: { projectApiKey: process.env.LMNR_PROJECT_API_KEY },
})
