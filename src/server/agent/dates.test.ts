import { describe, expect, it } from 'vitest'
import { endOfDayMs, formatLocal, mentionsTimeWindow, startOfDayMs, tzOffsetMs } from './dates'

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
