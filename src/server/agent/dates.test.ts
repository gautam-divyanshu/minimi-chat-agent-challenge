import { describe, expect, it } from 'vitest'
import { endOfDayMs, formatDateHints, formatLocal, mentionsTimeWindow, resolveDates, startOfDayMs, tzOffsetMs } from './dates'

describe('timezone helpers', () => {
  it('computes offsets, including half-hour zones', () => {
    expect(tzOffsetMs(Date.UTC(2026, 10, 3), 'Asia/Kolkata')).toBe(5.5 * 3600_000)
    expect(tzOffsetMs(Date.UTC(2026, 10, 3), 'UTC')).toBe(0)
  })

  it("maps a calendar day to the user's UTC range", () => {
    expect(new Date(startOfDayMs('2026-11-03', 'Asia/Kolkata')).toISOString()).toBe('2026-11-02T18:30:00.000Z')
    expect(new Date(endOfDayMs('2026-11-03', 'Asia/Kolkata')).toISOString()).toBe('2026-11-03T18:30:00.000Z')
    expect(new Date(startOfDayMs('2026-11-03', 'America/Los_Angeles')).toISOString()).toBe('2026-11-03T08:00:00.000Z')
  })

  it('handles DST transitions (US clocks fall back on 1 Nov 2026)', () => {
    const start = startOfDayMs('2026-11-01', 'America/New_York')
    const end = endOfDayMs('2026-11-01', 'America/New_York')
    expect(new Date(start).toISOString()).toBe('2026-11-01T04:00:00.000Z') // EDT
    expect(new Date(end).toISOString()).toBe('2026-11-02T05:00:00.000Z') // EST
    expect(end - start).toBe(25 * 3600_000)
  })

  it('formats in the user timezone', () => {
    expect(formatLocal(Date.UTC(2026, 10, 3, 8, 35), 'Asia/Kolkata')).toBe('Tue, 3 Nov 2026, 14:05')
  })
})

describe('mentionsTimeWindow', () => {
  it.each([
    'Has HubSpot shipped anything big since Monday?',
    'What did I ask you on 3 November? Is your answer still correct today?',
    'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?',
    'any changes in the last 3 days?',
    'what changed in 2026',
  ])('yes: %s', (t) => expect(mentionsTimeWindow(t)).toBe(true))

  it.each([
    'telling pricing of claude models',
    'Compare the cheapest paid plans of Neon, Supabase and PlanetScale right now.',
    'what is the latest iPhone price today',
    'Hi',
  ])('no: %s', (t) => expect(mentionsTimeWindow(t)).toBe(false))
})

describe('resolveDates (today: Wed 11 Nov 2026, Asia/Kolkata)', () => {
  const now = Date.UTC(2026, 10, 11, 6, 30)
  const r = (t: string) => resolveDates(t, now, 'Asia/Kolkata').map((d) => [d.text, d.from, d.to])

  it('named days are single days', () => {
    expect(r('What did I ask you on 3 November?')).toEqual([['on 3 November', '2026-11-03', '2026-11-03']])
    expect(r('On Monday we shortlisted 5 CRM tools')).toEqual([['On Monday', '2026-11-09', '2026-11-09']])
    expect(r('what did we discuss yesterday')).toEqual([['yesterday', '2026-11-10', '2026-11-10']])
  })

  it('"since X" and look-backs run up to today', () => {
    expect(r('Has HubSpot shipped anything big since Monday?')).toEqual([['since Monday', '2026-11-09', '2026-11-11']])
    expect(r('What has Supabase shipped in the last 48 hours?')).toEqual([['last 48 hours', '2026-11-09', '2026-11-11']])
    expect(r('any Next.js changes since last Friday?')).toEqual([['since last Friday', '2026-11-06', '2026-11-11']])
    expect(r('news from the past 3 days')).toEqual([['past 3 days', '2026-11-08', '2026-11-11']])
  })

  it('"last <weekday>" keeps both candidates', () => {
    const [d] = resolveDates('Last Tuesday I asked you about Postgres hosting.', now, 'Asia/Kolkata')
    expect([d.from, d.to]).toEqual(['2026-11-03', '2026-11-10'])
    expect(d.note).toMatch(/Tuesday 2026-11-10 or Tuesday 2026-11-03/)
  })

  it('a month is the whole month; today, now and future dates are skipped', () => {
    expect(r('what did we talk about in October')).toEqual([['October', '2026-10-01', '2026-10-31']])
    expect(r('What does Vercel Pro cost right now?')).toEqual([])
    expect(r('is it still correct today')).toEqual([])
    expect(r('remind me next Friday')).toEqual([])
  })

  it("uses the user's calendar day, not UTC", () => {
    // 11 Nov 01:00 IST is still 10 Nov in UTC; "yesterday" must be 10 Nov for the user.
    const early = Date.UTC(2026, 10, 10, 19, 30)
    expect(resolveDates('yesterday', early, 'Asia/Kolkata')[0].from).toBe('2026-11-10')
    expect(resolveDates('yesterday', early, 'UTC')[0].from).toBe('2026-11-09')
  })

  it('formats hints for the prompt', () => {
    expect(formatDateHints(resolveDates('since Monday', now, 'Asia/Kolkata'))).toEqual(['"since Monday" = 2026-11-09 to 2026-11-11'])
    expect(formatDateHints(resolveDates('on 3 November', now, 'Asia/Kolkata'))).toEqual(['"on 3 November" = 2026-11-03 (Tuesday)'])
  })
})
