import { evaluate } from '@lmnr-ai/lmnr'
import dataset from './data/multi-turn.json'
import { multiTurn } from './executors'
import { agentScorers } from './scorers'
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
  evaluators: agentScorers('multi-turn'),
  groupName: 'multi-turn',
  config: { projectApiKey: process.env.LMNR_PROJECT_API_KEY },
})
