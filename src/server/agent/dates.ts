import * as chrono from 'chrono-node'

/**
 * Timezone helpers built on Intl (no date library). Calendar days are always
 * the USER's days: "3 November" for someone in Asia/Kolkata starts at
 * 2 Nov 18:30 UTC.
 */

/** Offset of `timeZone` from UTC at instant `ms`, in milliseconds. */
export function tzOffsetMs(ms: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(ms)
      .map((p) => [p.type, Number(p.value)]),
  )
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

/** UTC ms of 00:00 on calendar day `isoDate` (YYYY-MM-DD) in `timeZone`. */
export function startOfDayMs(isoDate: string, timeZone: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  // Two passes handle a DST change between the guess and the real instant.
  const first = guess - tzOffsetMs(guess, timeZone)
  return guess - tzOffsetMs(first, timeZone)
}

/** UTC ms of the start of the day AFTER `isoDate`: exclusive end of that day. */
export function endOfDayMs(isoDate: string, timeZone: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  return startOfDayMs(next, timeZone)
}

/** "Mon, 3 Nov 2026, 14:05" in the user's timezone. */
export function formatLocal(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(ms)
}

/**
 * Did the user name a time window ("since Monday", "last 3 days", "in 2026")?
 * Date filters on web_search are only allowed when they did: left to itself
 * the model adds them anyway, which hides undated pages like pricing pages.
 * "now" / "today" alone mean "current", not a window.
 */
export function mentionsTimeWindow(text: string): boolean {
  if (/\b(19|20)\d{2}\b/.test(text)) return true
  return chrono.parse(text).some((r) => !/^(right )?now$|^today$|^tonight$|^this (minute|moment)$/i.test(r.text.trim()))
}

// --- Relative dates → exact dates, done by the harness, not the model ---------

export type ResolvedDate = {
  /** The user's words, e.g. "last Tuesday". */
  text: string
  /** Inclusive calendar days in the user's timezone (YYYY-MM-DD). */
  from: string
  to: string
  /** Why it is a range, when that isn't obvious. */
  note?: string
}

const isoDay = (ms: number, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(ms)
const addDays = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
const weekday = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(new Date(`${iso}T12:00:00Z`))

/**
 * Find date expressions in the user's message and turn each into exact days.
 * The model gets these as facts ("Monday" → 2026-11-09) so it never does date
 * arithmetic, and the harness uses them to enforce search date filters.
 *
 * - a named day ("on 3 November", "Monday", "yesterday") → that day
 * - "since X", or a look-back ("last 48 hours", "past 3 days", "last week") → X up to today
 * - a month ("in October") → the whole month
 * - "last <weekday>" → both candidates: on a Wednesday, "last Tuesday" may mean
 *   yesterday or the Tuesday of the week before
 */
export function resolveDates(text: string, now: number, timeZone: string): ResolvedDate[] {
  const today = isoDay(now, timeZone)
  const results = chrono.parse(text, { instant: new Date(now), timezone: tzOffsetMs(now, timeZone) / 60_000 }, { forwardDate: false })
  const out: ResolvedDate[] = []

  for (const r of results) {
    const phrase = r.text.trim()
    if (/^(right )?now$|^today$|^tonight$|^this (minute|moment)$/i.test(phrase)) continue
    const start = isoDay(r.start.date().getTime(), timeZone)
    if (start > today) continue // future dates say nothing about history or what was published

    const before = text.slice(Math.max(0, r.index - 12), r.index)
    const since = /\b(since|after|from)\s+(the\s+)?$/i.test(before)
    const lookBack = /\b(last|past|previous)\s+(\d+|few|couple|week|month|year)|\bago\b|\bthis (week|month|year)\b/i.test(phrase)
    const lastWeekday = /^last\s+(mon|tue|wed|thu|fri|sat|sun)/i.test(phrase)
    const wholeMonth = r.start.isCertain('month') && !r.start.isCertain('day') && !lookBack

    if (r.end) {
      out.push({ text: phrase, from: start, to: isoDay(r.end.date().getTime(), timeZone) })
    } else if (wholeMonth) {
      const [y, m] = start.split('-').map(Number)
      const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
      out.push({ text: phrase, from: `${start.slice(0, 8)}01`, to: last < today ? last : today })
    } else if (lastWeekday && !since) {
      const earlier = addDays(start, -7)
      out.push({
        text: phrase,
        from: earlier,
        to: start,
        note: `ambiguous: ${weekday(start)} ${start} or ${weekday(earlier)} ${earlier}; check both`,
      })
    } else if (since || lookBack) {
      out.push({ text: since && !lookBack ? `since ${phrase}` : phrase, from: start, to: today })
    } else {
      out.push({ text: phrase, from: start, to: start })
    }
  }
  return out
}

/** One line per expression, for the system prompt. */
export function formatDateHints(dates: ResolvedDate[]): string[] {
  return dates.map((d) => {
    const range = d.from === d.to ? `${d.from} (${weekday(d.from)})` : `${d.from} to ${d.to}`
    return `"${d.text}" = ${range}${d.note ? ` [${d.note}]` : ''}`
  })
}
