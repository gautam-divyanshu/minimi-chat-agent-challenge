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
