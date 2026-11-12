import { evaluate } from '@lmnr-ai/lmnr'
import dataset from './data/general.json'
import { multiTurn } from './executors'
import { agentScorers } from './scorers'
import type { MultiTurnData, MultiTurnTarget } from './types'

/**
 * General chat-with-search evaluation: the questions people actually ask a
 * search agent, beyond the brief's time-and-memory examples. News, how-to
 * from docs, factual lookups, multi-hop questions, sources that disagree,
 * nothing found, a wrong premise, follow-ups, recommendations, depth on
 * request, another language, a pasted link. Same harness, scorers and fake
 * search engine as multi-turn.eval.ts; entities are invented where the answer
 * must come from the sources and not from the model's memory.
 */
evaluate({
  data: dataset as { data: MultiTurnData; target: MultiTurnTarget }[],
  executor: multiTurn,
  evaluators: agentScorers('general'),
  groupName: 'general',
  config: { projectApiKey: process.env.LMNR_PROJECT_API_KEY },
})
