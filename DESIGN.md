# Design: Web-Search Chat Agent

## Overview

This is a single-agent chat application with web search. The model decides when it needs external information, requests a search through a controlled tool interface, observes the results, and either searches again or produces a grounded answer.

The agent loop lives in `agent/loop.ts`. It is deliberately application-owned: the model SDK is used for a streamed model call, but the application controls tool execution, iteration limits, cancellation, persistence, and recovery.

Three responsibilities are kept apart, and the diagram groups them the same way:

- **Turn management** owns persistence, streaming, cancellation, and recovery.
- **Agent orchestration** decides what to do next, runs the loop, and decides when to stop.
- **Tool execution** validates requests, runs tools, enforces timeouts, and returns observations.

![Architecture](docs/architecture.svg)

Editable source: [docs/architecture.excalidraw](docs/architecture.excalidraw).

## How it works

1. **Start a turn.** The server creates and owns the turn lifecycle. Conversation context (rules plus the last 20 messages) is loaded before the model is called.
2. **Resolve dates.** `agent/dates.ts` interprets relative dates ("since Monday", "3 November") using the browser's timezone and hands them to the model as exact days. The tool-execution layer then enforces the search window: it adds the resolved window if the model omits it and strips date constraints when the user did not request one.
3. **Plan and act.** The model can request `web_search`. The application validates each request and executes it; tool definitions do not contain model-controlled `execute` functions.
4. **Observe results.** Search results are normalized, deduplicated, and returned to the model. Independent searches run concurrently with `Promise.all`. Each call has its own 15-second timeout, which bounds tail latency; there is no batch deadline. Failures are isolated: a failed or timed-out search becomes an error result for that call and does not discard the results of the others. Measured, a batch of three or more searches takes about 1.8 s, against 6.8 s one after another.
5. **Continue or answer.** The model can request another search or produce a final answer. The loop is capped at six steps; on the final step, tools are disabled so the model must answer using the evidence already collected.
6. **Stream and persist.** Turn events are logged and streamed to the client over SSE. The answer is saved every 500 ms, so a refresh replays the events and continues live. Stop requests abort work server-side; interrupted turns are marked on restart.

There are two tools. `web_search` (Exa) is the only external one. `recall_history` is the agent reading its own database: SQLite with FTS5, for date-range and keyword retrieval of past conversations, rather than a vector database. When nothing matches it says so, so a fresh instance reports that it has no record instead of inventing a past conversation.

Search results and recalled conversations are treated as untrusted data, never as instructions. They reach the model only as tool results, the system rules say not to act on instructions found in them, and an eval case with an injected instruction in a page checks this.

## Why this design

The first version took about **22.8 seconds to first word**. Search itself took roughly 1.6 seconds; most of the delay came from model planning and reasoning. Reducing search results from ten to five, returning concise highlights instead of full pages, lowering reasoning and verbosity, and streaming events brought first-word latency to roughly **seven seconds**. Medium reasoning increased it to around 19.5 seconds, so it was reverted.

The main design choice is to keep the agent loop explicit and small. This gives the application control over latency, parallel tool calls, timeouts, errors, cancellation, and the maximum amount of work a turn can perform. A single Node process is sufficient for the current local, single-user workload.

Date handling is explicit because date mistakes can silently make search results incomplete. Running dated and undated searches in parallel preserves useful official pages that have no publication date.

Evals use the real agent harness, an in-memory database, a fake search provider, and a fixed clock. Code checks and an LLM judge cover behavior; Laminar provides runtime observability.

| Eval set | Cases | Passing | Judge score |
|---|---|---|---|
| Tool selection | 17 | 17 | n/a |
| Time and memory | 18 | 17 | 0.97 to 0.99 |
| General questions | 15 | 10 to 12 | 0.94 to 0.98 |

"Passing" means every scorer gave full marks, including a 10/10 from the judge, so it is stricter than the judge score, which is the average rubric score across cases. The model is not deterministic, so results are given as the range over the last few runs; the general set passed 8 of 14 before tuning.

Known weaknesses: recommendations sometimes under-use what the user said earlier, and an answer occasionally adds a detail its source does not state.

## Alternatives considered and rejected

- **Built-in web search:** rejected because it offered insufficient control over date filters, timeouts, and event handling.
- **Agent framework / `useChat` orchestration:** rejected in favor of a small custom loop with application-owned execution and lifecycle semantics.
- **Multiple agents:** unnecessary coordination and latency for a workflow with one external tool.
- **Vector database:** unnecessary for the current history-retrieval requirements; SQLite FTS5 is simpler and supports exact date filtering.
- **Postgres, queues, workers, and a gateway:** operational complexity without a current multi-user or multi-process requirement.
- **SSR and more elaborate infrastructure:** not justified by the current product and deployment needs.

## What I would do with another week

In the order I would spend the week:

1. **Trust:** fetch the full content of the one or two best search results instead of relying only on highlights, and add stronger source-grounding and citation validation.
2. **Quality:** summarize older turns instead of a fixed 20-message window, and make history retrieval more useful for personalization.
3. **Speed:** evaluate a smaller, faster planner for the first step and remove unnecessary model round trips.
4. **Reliability:** persist per-step checkpoints so interrupted turns resume safely, which is also the path to more than one process.
5. **Regression prevention:** run the evals in CI and add adversarial date and source-attribution cases. The first eval set was biased toward pricing and date questions; the general set corrects that.

The priority is better evidence, then quality and speed, not more agents or infrastructure.
