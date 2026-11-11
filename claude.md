# Minimi hiring challenge: chat agent with web search

## The brief (from the challenge)
- Build a chat agent we can talk to. It has one tool: web search. Make it as good as the best on the internet.
- Judged on **architecture**: answers fast, gets things right, good to talk to. They chat with it like a real user, read the code, read DESIGN.md.
- Rules: JavaScript/TypeScript on Node. Must run with `npm install` then `npm run dev`. Every API key listed in `.env.example`.
- Deliver: public GitHub repo + one-page `DESIGN.md` (how it works, why, what was considered and rejected, what I'd do with another week).
- Example test questions (these are memory + time questions, not just search):
  - "On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?"
  - "What did I ask you on 3 November? Is your answer still correct today?"
  - "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?"
- Judges will likely use a fresh instance with **no history**. Never invent a past conversation; say clearly when there's no record.

## Final stack (decided — don't change without asking)
| Layer | Choice |
|---|---|
| Runtime | Node >= 22.13, TypeScript (`"engines": { "node": ">=22.13" }`) |
| Framework | TanStack Start in **SPA mode (SSR off)**, React for UI, server routes for the API |
| LLM | OpenAI, **one model**, via `@ai-sdk/openai`, set by `OPENAI_MODEL` env var |
| Agent loop | AI SDK `streamText` for model calls only; **hand-written loop** that owns tool execution, step cap, timeouts, events (pattern from Scott Moss's harness course: no automatic SDK tool execution) |
| Tools | `web_search` (Exa) and `recall_history` (SQLite) |
| Search | **Exa only** (date filters + page contents) |
| Transport | **SSE** with typed custom events (not `useChat`) |
| UI | React + Tailwind + shadcn/ui; react-markdown with memoized finished blocks |
| DB | `node:sqlite` + Drizzle ORM + FTS5 for keyword recall |
| Dates | chrono-node in the harness, using the browser's IANA timezone |
| Tests | Vitest unit tests (`npm test`, offline) + live tests (`npm run test:live`) |
| Evals + tracing | Laminar (`@lmnr-ai/lmnr`), as in the agents-v2 course: `evaluate()` datasets with code scorers + LLM judge (`npm run eval`); traces per chat turn. Optional at runtime: no key, no tracing |
| `.env.example` | `OPENAI_API_KEY`, `EXA_API_KEY`, `OPENAI_MODEL`, `LMNR_PROJECT_API_KEY` (optional for chatting) |

## Architecture
```
Browser (SPA)
  │  POST /api/chat {conversationId, text, timezone}
  ▼
Server route → agent harness
  1. Save user message
  2. Resolve relative dates (chrono-node) in user's timezone → exact ranges
  3. Build context: system prompt (now, weekday, tz, rules) + running summary + recent turns + date hints
  4. Loop (max 6 steps): model → tool calls → execute in parallel with timeouts → append results
     Emit every event to SSE AND persist it as it happens
  5. Save final answer → emit turn_done
  6. Background (after streaming finishes, never blocking the reply): extract claims, set chat title
  ▼
SQLite: conversations · messages · tool_events · claims · messages_fts
```

## Data model
- `conversations`: id, title, created_at
- `messages`: id, conversation_id, role, text, created_at (UTC ms integer), timezone (IANA)
- `tool_events`: id, message_id, tool, input (JSON), output (JSON), started_at, duration_ms
- `claims`: id, message_id, entity, attribute, value, source_url, observed_at
- `messages_fts`: FTS5 index over messages.text
- Rule: everything we query is a real column. Only tool input/output is JSON. Timestamps are UTC ms integers.

## Tools
`web_search({ query, objective, since?, until? })`
- Follows Exa's build-with-exa skill: `type: "auto"`, `contents: { highlights: true }`, required `objective` (Exa's verbatim description), no numResults/category/domain filters
- since/until → published-date filters, only for a window the user stated ("since Monday"), never for "latest"
- Results: title, url, published date, highlights. numResults 5 (benchmarked: halves model input, same correctness)
- Speed settings in `model.ts` MODEL_SETTINGS: reasoningEffort low, textVerbosity low. Benchmark (`bench.live.test.ts`, 3-product question): 22.8s→8.5s first text, 27.3s→13.7s total
- Errors returned as tool results (`{ error: "timeout" }`), never thrown
- A dated search never replaces the normal one: unfiltered + date-filtered run in parallel, merged, each result marked `inWindow`. Reason: date filters drop undated pages, and official pricing pages are undated (a model-added `since` once returned only aggregators)
- Harness sets `allowDates: false` unless the user named a time window in the last 3 user messages (`mentionsTimeWindow` in `dates.ts`); since/until are then ignored

`recall_history({ from?, to?, query? })`
- Past messages by date range and/or FTS5 keywords, with timestamps + their stored claims
- Returns explicit "no conversations found in this range" when empty
- DESIGN.md must justify this second tool: web_search is the only *external* tool; recall_history is the agent's own memory

## SSE event protocol
`turn_started` · `tool_started {tool, input}` · `tool_finished {tool, sources}` · `text_delta {text}` · `turn_done {messageId}` · `error {message}`
Client: small `useAgentStream` hook (~100 lines) reads the stream and keeps message state.

## System prompt rules
- Today is {date, weekday} in {timezone}. Resolved dates: {hints}.
- Questions about past conversations → call recall_history before answering. Never invent a past conversation.
- Anything current (prices, releases, news) → search; use `since` when the user says "since X".
- Prefer official sources (pricing pages, changelogs). Cite every claim with its date.
- State what changed, what didn't, and what couldn't be verified.
- Search independent items in parallel (e.g. 5 CRM tools → 5 searches at once).

## Build plan
Day 1 — foundation
1. Scaffold TanStack Start (SPA mode), Tailwind, shadcn. **First: verify node:sqlite + Drizzle works inside TanStack Start** (riskiest combination).
2. Schema + migrations, db helper, FTS5 setup
3. Agent loop: step cap, parallel tool execution, timeouts, event emission
4. web_search (Exa), then recall_history
5. SSE route, useAgentStream hook, basic chat UI with source chips and chat sidebar

Day 2 — differentiators
6. chrono-node date resolution + browser timezone, with unit tests
7. Background claim extraction; claims included in recall_history results
8. Compaction: running summary once history passes a token threshold
9. Evals: 15–20 seeded scenarios (empty memory, price changed since date, nothing changed, ambiguous date, 5 parallel searches, search failure), LLM judge, results in README
10. Polish: time-to-first-event speed pass, error states, README, DESIGN.md

## Decisions and reasons (for DESIGN.md)
- SQLite over Postgres/Convex: zero setup for judges (`npm install && npm run dev`); single user; exact date queries; FTS5 built in. Postgres (Neon) + pgvector + DBOS listed under "another week".
- No SSR: private local app, no SEO, bottleneck is LLM/search latency; SSR adds hydration/timezone bugs.
- No vector DB: queries are by date and named topic → SQL + FTS5 is exact. Embeddings = "another week".
- No multi-agent / handoffs: one tool, extra hops add latency.
- Hand-written loop over framework: judges read the code; every step explainable.
- Lessons from T3 Chat: stream immediately, persist stream as it arrives, typed message parts, server is the source of truth (no local-first/IndexedDB), real columns not JSON blobs, design schema around known queries.

## Conventions
- Keep the agent harness framework-free (`src/server/agent/`), importable by evals and a CLI.
- Ask before changing any stack decision above.