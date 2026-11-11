import { createOpenAI } from '@ai-sdk/openai'
import { requireEnv } from '../env'

// One model for everything, chosen by OPENAI_MODEL.
export function getModel() {
  const openai = createOpenAI({ apiKey: requireEnv('OPENAI_API_KEY') })
  return openai(requireEnv('OPENAI_MODEL'))
}

/**
 * Speed settings, picked by src/server/agent/bench.live.test.ts. Time is
 * dominated by the final call writing the answer, so short answers
 * (textVerbosity) matter most; low reasoning gets the first word out sooner.
 */
export const MODEL_SETTINGS = {
  openai: { reasoningEffort: 'low', textVerbosity: 'low' },
}
