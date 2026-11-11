import { existsSync } from 'node:fs'

// Vite only exposes VITE_* vars to import.meta.env; server code reads
// process.env, so load .env with Node's built-in parser (no dotenv dependency).
if (existsSync('.env')) process.loadEnvFile('.env')

export function requireEnv(name: 'OPENAI_API_KEY' | 'EXA_API_KEY' | 'OPENAI_MODEL'): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`)
  return value
}
