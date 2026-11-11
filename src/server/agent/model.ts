import { createOpenAI } from '@ai-sdk/openai'
import { requireEnv } from '../env'

// One model for everything, chosen by OPENAI_MODEL.
export function getModel() {
  const openai = createOpenAI({ apiKey: requireEnv('OPENAI_API_KEY') })
  return openai(requireEnv('OPENAI_MODEL'))
}
