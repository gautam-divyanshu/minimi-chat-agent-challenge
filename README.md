# Chat agent with web search

A chat agent you can talk to in the browser. It has one external tool, web search (Exa), plus its own memory of past conversations, so it can answer questions like "What did I ask you on 3 November? Is your answer still correct today?"

## Run it

Requires Node 22.13 or newer.

```bash
npm install
cp .env.example .env   # then fill in the keys
npm run dev            # http://localhost:3000
```

Keys in `.env`:

| Key | Needed for |
|---|---|
| `OPENAI_API_KEY` | the model |
| `OPENAI_MODEL` | which OpenAI model to use (built and measured with `gpt-5-mini`) |
| `EXA_API_KEY` | web search |
| `LMNR_PROJECT_API_KEY` | optional: tracing and evals |

The database is a local SQLite file (`data/chat.db`), created on first start. There is nothing else to set up. Delete the file to start with no history.

## How it works

```
Browser (React SPA)
  │  POST /api/chat {conversationId, text, timezone}  →  Server-Sent Events
  ▼
Agent harness (src/server/agent/)
  1. Save the user message
  2. Build context: system prompt (today's date, timezone, rules) + recent turns
  3. Loop, at most 6 model calls: model → tool calls → run them in parallel with timeouts → feed results back
     Every event is streamed to the browser and saved as it happens
  4. Save the final answer
  ▼
SQLite: conversations · messages · tool_events · claims · messages_fts (FTS5)
```

- `src/server/agent/loop.ts`: the agent loop. The AI SDK makes one streamed model call per step; the loop runs the tools itself.
- `src/server/agent/tools/web-search.ts`: Exa search. A dated search ("since Monday") runs alongside an undated one, because date filters hide pages with no publish date, such as pricing pages.
- `src/server/agent/tools/recall-history.ts`: past conversations by date range (in the user's timezone) and keywords.
- `src/server/agent/harness.ts`: one chat turn end to end; used by the HTTP route and by tests.
- `src/client/useAgentStream.ts`: reads the event stream in the browser.

## Tests

```bash
npm test             # unit tests: offline, no API calls
npm run test:live    # calls OpenAI and Exa with your keys (a few cents)
npm run typecheck
```

`DESIGN.md` (how it works, why, what was considered and rejected) is in progress.
