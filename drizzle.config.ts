import { defineConfig } from 'drizzle-kit'

// Used only for `npm run db:generate` (writes SQL migrations to ./drizzle).
// Migrations are applied at server start by src/server/db/client.ts.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
})
