# Design: a chat agent with web search

**The pain:** _Why is a model with a search tool still not a good search agent?_

Giving a model a search tool takes ten lines. The result looks fine in a demo and then: it answers from memory when it should search, runs five lookups one after another, hangs on one slow request, pads sourced facts with details it made up, loses the answer on a page refresh, and has no idea what "since Monday" means or what you asked it last week. The best agents on the internet differ from the demo in the layer around the model, not in the model.

> The line this project is built on: **the model decides the next step; the harness owns execution.** Parallelism, timeouts, dates, memory and persistence are code, not prompt.

The three goals, and what serves each:

| Goal | What does it |
|---|---|
| **Fast** | parallel searches, streaming from the first event, small context, low reasoning effort |
| **Right** | official sources first, citations checked against what search returned, dates resolved in code, "no record" instead of invention |
| **Good to talk to** | length follows the question, uses what you said earlier, survives refresh, shows its searches as they run |

Diagram: [docs/architecture.excalidraw](docs/architecture.excalidraw).

## What the harness adds

```
Browser (React SPA) ─ POST /api/chat ─▶ API routes ─▶ Turn registry ─▶ Harness ─▶ Agent loop ─▶ OpenAI
       ◀──────────── SSE events ───────────┘                │                        └─▶ web_search → Exa
                                                         SQLite ◀──────────────────────── recall_history
```

One Node process. No API gateway, queue or worker pool: this is a single-user local app, and each of those adds setup and latency without solving a problem it has.

### 1. `agent/loop.ts`: the loop runs the tools, not the SDK

The AI SDK makes one streamed model call per step. Tools are declared **without** `execute`, so a tool call ends the step and the loop decides what happens next: validate the arguments, run every call in parallel, each with its own timeout.

```ts
// Independent tool calls run in parallel (5 products → 5 searches at once).
const runs = await Promise.all(calls.map((c) => runTool(c, byName.get(c.tool), onEvent, signal)))

// inside runTool: errors become tool results the model can reason about; never thrown.
const timeout = AbortSignal.timeout(tool.timeoutMs)
try {
  output = await raceAbort(tool.execute(input, { signal }), signal)
} catch (err) {
  error = timeout.aborted ? 'timeout' : errorMessage(err)
}
```

- **At most 6 steps**, so a question that needs one search to write the next ("who founded the company that acquired X?") can chain them. On the last step tools are switched off and the model answers from what it has.
- **One slow search fails alone.** The model sees `{ error: "timeout" }` for that call and uses the rest.
- **Everything is an event:** `tool_started`, `tool_finished`, `text_delta`, `turn_done`. The UI, the database and the tracer consume the same stream.

### 2. `tools/web-search.ts`: one external tool, tuned

Exa, 5 results, highlights instead of full pages: half the input tokens of 10 results with the same correctness on our evals. Results carry title, URL and publish date, so every claim can be cited and the UI can number the sources. An empty result says "search worked, nothing found", so the model reports that instead of guessing.

A search with a time window sends an undated and a date-filtered query together and merges them. Date filters drop pages with no publish date, and official pages (pricing, docs) have none:

```ts
// Current state and what was published in the window, side by side.
const [current, windowed] = await Promise.allSettled([search(false), search(true)])
```

### 3. `agent/dates.ts` and `tools/recall-history.ts`: a clock and a memory

Two things a chat agent needs that search does not give it.

- **Clock.** chrono-node resolves "since Monday" or "3 November" into exact days in the browser's timezone before the model runs. The harness enforces the search window: added if the model forgets it, removed if the user never gave one.
- **Memory.** The brief says one tool. `web_search` is the only *external* one; `recall_history` is the agent reading its own SQLite (date range on a real column, FTS5 keywords). Without it, "what did I ask you last week?" can only be invented. When nothing matches it says so, and so does the agent.

### 4. `agent/turns.ts` + `agent/harness.ts`: a turn belongs to the server

`runTurn` is one turn end to end: save the message, resolve dates, build context (rules + last 20 messages), run the loop, save the answer every 500 ms while it streams. The turn registry keeps running turns apart from the HTTP request, with their event log in memory. Refresh mid-answer and the page replays the log, then follows live. Stop is a server-side abort that keeps the partial answer.

`runTurn` has no framework imports. The HTTP route, the unit tests and the evals all call the same function.

## Where the time goes

A searched answer with `gpt-5-mini`, measured on real turns:

| Phase | Time |
|---|---|
| Step 1: model decides which searches to run | ~4.3 s |
| Searches, in parallel (1.8 s for a batch of three or more; 6.8 s if serial) | ~1.8 s |
| Step 2: model reads results; first word | at ~7 s |
| Answer finishes streaming | ~10 to 14 s |

Two model calls dominate; search is the small part. What keeps it down: low reasoning effort and low verbosity, a small context, stable rules first in the prompt so the prefix is cached, and every event streamed at once so the user sees searches start within seconds. It was 22.8 s to the first word before these settings. Medium reasoning effort scored slightly higher on evals but took about 19.5 s to the first word, so low effort stays.

## How we know it works: evals

Method from the agents course: **baseline → one change → re-run → keep or revert.** Laminar `evaluate()` runs three datasets through the real `runTurn`, on an in-memory database with a fake search engine and a fixed clock (`npm run eval`):

| Dataset | What it covers | Fully passing | Judge |
|---|---|---|---|
| General, 14 cases | news, how-to from docs, lookups, two-step questions, sources that disagree, nothing found, false premise, pasted link, follow-ups, recommendations, depth, another language | 10 to 12 | 0.94 to 0.96 |
| Time and memory, 18 cases | the brief's three questions on empty and seeded history, search failure, answer format | 17 | 0.97 to 0.99 |
| Tool selection, 17 cases | right tool, right arguments, parallel calls | 17 | |

Scorers are code checks (tool order, date arguments, every cited URL is one the search returned) plus an LLM judge with a rubric per case. The general set started at 8/14: the first version was tuned on the brief's examples and was weaker everywhere else. Known misses today: recommendations that underuse what the user said, and an occasional detail the source does not state.

## Considered and rejected

- **OpenAI's built-in web search**: no date filters, no control over results or timeouts, no events of our own.
- **Vector database**: recall is by date and named topic, which SQL and FTS5 answer exactly.
- **Postgres**: SQLite needs zero setup (`npm install && npm run dev`) and has FTS5 built in.
- **Multi-agent, handoffs**: one tool; extra hops only add latency.
- **Agent framework, `useChat`**: a hand-written loop and typed SSE keep every step readable and testable.
- **SSR**: a private local app; it would add hydration and timezone problems for no gain.

## In production (with another week)

- **Deeper reading**: fetch the full text of the best one or two pages for research questions. Highlights are enough for facts and thin for long explanations.
- **Compaction**: a running summary once a conversation passes a token budget, replacing the fixed 20-message window.
- **Durable execution**: a server restart marks an answer `interrupted` today. Checkpointing each step (Postgres + a workflow engine) would resume it, and is the path to more than one process.
- **A faster first step**: step 1 is 4 s of the model choosing searches. A smaller model for that step is the biggest remaining latency win.
- **Evals in CI**, with cases added from real use.
