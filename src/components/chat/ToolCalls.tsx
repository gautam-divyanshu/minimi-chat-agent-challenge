import { Check, ChevronRight, CircleAlert, History, Loader2, Search } from 'lucide-react'
import { useState } from 'react'
import type { ToolCallState } from '#/client/useAgentStream'
import type { Source } from '#/shared/events'
import { cn } from '#/lib/utils'
import { cleanCitations } from '#/shared/citations'
import { normalizeUrl, type CitationMap } from './Markdown'

// What the agent is doing: one row per tool call while it works, collapsed to
// a one-line summary once the answer starts. Then the numbered source list.

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))

function label(t: ToolCallState): string {
  const { query, since, until, from, to } = t.input ?? {}
  if (t.tool === 'web_search') {
    // Show the date filter the harness actually applied.
    const window = since && until ? `${shortDate(since)} – ${shortDate(until)}` : since ? `since ${shortDate(since)}` : until ? `until ${shortDate(until)}` : ''
    return [query ?? 'Searching the web', window].filter(Boolean).join(' · ')
  }
  if (t.tool === 'recall_history') {
    const range = from && to && from !== to ? `${shortDate(from)} – ${shortDate(to)}` : from || to ? shortDate(from ?? to) : ''
    return ['Past conversations', range, query && `“${query}”`].filter(Boolean).join(' · ')
  }
  return t.tool
}

function Row({ t }: { t: ToolCallState }) {
  const Icon = t.tool === 'recall_history' ? History : Search
  return (
    <li className="flex items-center gap-2">
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
}

function summary(tools: ToolCallState[]): string {
  const searches = tools.filter((t) => t.tool === 'web_search')
  const recalls = tools.filter((t) => t.tool === 'recall_history').length
  const results = searches.reduce((n, t) => n + t.sources.length, 0)
  const failed = tools.filter((t) => t.error).length
  return [
    recalls && 'Checked past conversations',
    searches.length && `Searched the web · ${searches.length} ${searches.length === 1 ? 'search' : 'searches'} · ${results} results`,
    failed && `${failed} failed`,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function ToolCalls({ tools, collapsed }: { tools: ToolCallState[]; collapsed: boolean }) {
  const [open, setOpen] = useState(false)
  if (!tools.length) return null
  if (!collapsed) {
    return (
      <ul className="mb-3 space-y-1 text-xs text-muted-foreground">
        {tools.map((t) => (
          <Row key={t.callId} t={t} />
        ))}
      </ul>
    )
  }
  return (
    <div className="mb-3 text-xs text-muted-foreground">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 hover:text-foreground" aria-expanded={open}>
        <span>{summary(tools)}</span>
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 border-l pl-3">
          {tools.map((t) => (
            <Row key={t.callId} t={t} />
          ))}
        </ul>
      )}
    </div>
  )
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Every source the tools returned in this turn, once per URL. */
export function uniqueSources(tools: ToolCallState[]): Source[] {
  const seen = new Set<string>()
  const all: Source[] = []
  for (const s of tools.flatMap((t) => t.sources)) {
    const key = normalizeUrl(s.url)
    if (!seen.has(key) && seen.add(key)) all.push(s)
  }
  return all
}

/** Number the sources the answer links to, in order of first appearance. */
export function buildCitations(text: string, sources: Source[]): { map: CitationMap; cited: Source[] } {
  const byUrl = new Map(sources.map((s) => [normalizeUrl(s.url), s]))
  const map: CitationMap = new Map()
  const cited: Source[] = []
  for (const m of cleanCitations(text).matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)) {
    const key = normalizeUrl(m[1])
    const source = byUrl.get(key)
    if (source && !map.has(key)) {
      cited.push(source)
      map.set(key, { n: cited.length, title: source.title })
    }
  }
  // An answer with no inline links still gets its sources listed.
  if (cited.length === 0) cited.push(...sources.slice(0, 6))
  return { map, cited }
}

/** The numbered source list under an answer: one chip per cited page. */
export function Sources({ cited }: { cited: Source[] }) {
  if (!cited.length) return null
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {cited.map((s, i) => (
        <a
          key={s.url}
          href={s.url}
          target="_blank"
          rel="noreferrer noopener"
          title={`${s.title}\n${s.url}`}
          className="inline-flex max-w-72 items-center gap-1.5 rounded-full border bg-card py-1 pr-2.5 pl-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">{i + 1}</span>
          <span className="truncate text-foreground/80">{s.title || host(s.url)}</span>
          <span className="shrink-0 opacity-70">
            {host(s.url)}
            {s.publishedAt && ` · ${shortDate(s.publishedAt)}`}
          </span>
        </a>
      ))}
    </div>
  )
}
