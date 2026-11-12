import { existsSync } from 'node:fs'

// Vite only exposes VITE_* vars to import.meta.env; server code reads
// process.env, so load .env with Node's built-in parser (no dotenv dependency).
if (existsSync('.env')) process.loadEnvFile('.env')

// Say at startup which keys are missing (names only, never values), so a
// first run without .env explains itself before the first message fails.
const missing = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'EXA_API_KEY'].filter((k) => !process.env[k]?.trim())
if (missing.length) console.warn(`[chat-agent] Missing in .env: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`)

export function requireEnv(name: 'OPENAI_API_KEY' | 'EXA_API_KEY' | 'OPENAI_MODEL'): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`)
  return value
}
