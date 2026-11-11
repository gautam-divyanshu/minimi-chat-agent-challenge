import { Check, CircleAlert, History, Loader2, Search } from 'lucide-react'
import type { ToolCallState } from '#/client/useAgentStream'
import type { Source } from '#/shared/events'

// What the agent is doing, live: one row per tool call, then source chips.

function label(t: ToolCallState): string {
  if (t.tool === 'web_search') return t.input?.query ?? 'Searching the web'
  if (t.tool === 'recall_history') {
    const { from, to, query } = t.input ?? {}
    const range = from && to && from !== to ? `${from} → ${to}` : from ?? to
    return ['Past conversations', range, query && `“${query}”`].filter(Boolean).join(' · ')
  }
  return t.tool
}

export function ToolCalls({ tools }: { tools: ToolCallState[] }) {
  if (!tools.length) return null
  return (
    <ul className="mb-3 space-y-1 text-xs text-muted-foreground">
      {tools.map((t) => {
        const Icon = t.tool === 'recall_history' ? History : Search
        return (
          <li key={t.callId} className="flex items-center gap-2">
            {t.status === 'running' ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
            ) : t.error ? (
              <CircleAlert className="size-3.5 shrink-0 text-amber-500" />
            ) : (
              <Check className="size-3.5 shrink-0 text-emerald-600" />
            )}
            <Icon className="size-3.5 shrink-0 opacity-60" />
            <span className="truncate">{label(t)}</span>
            {t.status === 'done' && (
              <span className="shrink-0 opacity-60">
                {t.error ? (t.error === 'timeout' ? 'timed out' : 'failed') : t.tool === 'web_search' ? `${t.sources.length} results` : ''}
                {t.durationMs != null && ` · ${(t.durationMs / 1000).toFixed(1)}s`}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Sources the answer actually cites come first; then the rest, deduplicated. */
export function Sources({ tools, text }: { tools: ToolCallState[]; text: string }) {
  const seen = new Set<string>()
  const all: Source[] = []
  for (const s of tools.flatMap((t) => t.sources)) if (!seen.has(s.url) && seen.add(s.url)) all.push(s)
  if (!all.length) return null
  const cited = all.filter((s) => text.includes(s.url))
  const shown = (cited.length ? cited : all).slice(0, 8)
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {shown.map((s) => (
        <a
          key={s.url}
          href={s.url}
          target="_blank"
          rel="noreferrer noopener"
          title={s.title}
          className="inline-flex max-w-64 items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <span className="truncate font-medium text-foreground/80">{host(s.url)}</span>
          {s.publishedAt && <span className="shrink-0 opacity-70">{s.publishedAt}</span>}
        </a>
      ))}
    </div>
  )
}
