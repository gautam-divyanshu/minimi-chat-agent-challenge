import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// SPA mode: no SSR. This is a private local app with no SEO needs; the
// latency that matters is the LLM + search, and SSR would only add
// hydration and timezone mismatch bugs. Server routes still run on Node.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: { port: 3000 },
  plugins: [tailwindcss(), tanstackStart({ spa: { enabled: true } }), viteReact()],
})
