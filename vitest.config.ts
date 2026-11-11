import { defineConfig } from 'vitest/config'

// `npm test` is offline and free. `npm run test:live` also runs *.live.test.ts,
// which call the real APIs with the keys in .env.
const live = process.env.LIVE === '1'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'evals/**/*.test.ts'],
    exclude: live ? [] : ['src/**/*.live.test.ts'],
    testTimeout: live ? 60_000 : 5_000,
    // Offline runs must not send traces: an empty value wins over .env.
    env: live ? {} : { LMNR_PROJECT_API_KEY: '' },
  },
})
