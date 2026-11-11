import { describe, expect, it } from 'vitest'
import { argsCorrect, attribution, citations, cleanOutput, mentions, toolOrderCorrect, toolSelectionScore, toolsAvoided, toolsSelected } from './evaluators'
import type { MultiTurnResult } from './types'

const out = (answer: string, returnedUrls: string[] = []): MultiTurnResult => ({
  answer,
  returnedUrls,
  toolCalls: [],
  toolNames: [],
  toolResults: '',
  seconds: 0,
  firstTextSeconds: 0,
})
const rubric = ''

describe('tool scorers', () => {
  it('toolsSelected / toolsAvoided', () => {
    expect(toolsSelected({ toolNames: ['web_search', 'web_search'] }, { expectedTools: ['web_search'] })).toBe(1)
    expect(toolsSelected({ toolNames: [] }, { expectedTools: ['web_search'] })).toBe(0)
    expect(toolsAvoided({ toolNames: ['web_search'] }, { forbiddenTools: ['web_search'] })).toBe(0)
    expect(toolsAvoided({ toolNames: [] }, { forbiddenTools: ['web_search'] })).toBe(1)
  })

  it('toolSelectionScore is F1', () => {
    expect(toolSelectionScore({ toolNames: ['recall_history', 'web_search'] }, { expectedTools: ['recall_history', 'web_search'] })).toBe(1)
    expect(toolSelectionScore({ toolNames: ['recall_history'] }, { expectedTools: ['recall_history', 'web_search'] })).toBeCloseTo(2 / 3)
    expect(toolSelectionScore({ toolNames: [] }, { expectedTools: ['recall_history'] })).toBe(0)
  })

  it('toolOrderCorrect allows other calls in between', () => {
    const target = { expectedToolOrder: ['recall_history', 'web_search'] }
    expect(toolOrderCorrect({ toolNames: ['recall_history', 'recall_history', 'web_search', 'web_search'] }, target)).toBe(1)
    expect(toolOrderCorrect({ toolNames: ['web_search', 'recall_history'] }, target)).toBe(0)
  })

  it('argsCorrect: equals, contains, absent', () => {
    const calls = { toolCalls: [{ toolName: 'web_search', args: { query: 'Neon Postgres pricing', since: '2026-11-09' } }] }
    expect(argsCorrect(calls, [{ tool: 'web_search', arg: 'since', equals: '2026-11-09' }, { tool: 'web_search', arg: 'query', contains: 'postgres' }])).toBe(1)
    expect(argsCorrect(calls, [{ tool: 'web_search', arg: 'since', absent: true }])).toBe(0)
    expect(argsCorrect({ toolCalls: [{ toolName: 'web_search', args: { query: 'q' } }] }, [{ tool: 'web_search', arg: 'since', absent: true }])).toBe(1)
  })
})

describe('answer scorers', () => {
  it('mentions: all required patterns, none of the banned ones', () => {
    expect(mentions(out('Pro was $25, now $29.'), { rubric, mustMention: ['\\$25', '\\$29'] })).toBe(1)
    expect(mentions(out('Pro was $25.'), { rubric, mustMention: ['\\$25', '\\$29'] })).toBe(0.5)
    expect(mentions(out('Search failed. It is probably $20.'), { rubric, mustMention: ['failed'], mustNotMention: ['\\$\\s?\\d'] })).toBe(0)
  })

  it('citations: only returned URLs, required and banned domains', () => {
    const returned = ['https://claude.com/pricing', 'https://13k.eu/claude']
    expect(citations(out('Pro $20 [Pricing](https://claude.com/pricing).', returned), { rubric, mustCite: ['claude.com'], mustNotCite: ['13k.eu'] })).toBe(1)
    expect(citations(out('Pro $20 [guide](https://13k.eu/claude).', returned), { rubric, mustCite: ['claude.com'], mustNotCite: ['13k.eu'] })).toBe(0)
    // A link no tool returned is an invented citation.
    expect(citations(out('See [docs](https://claude.com/made-up).', returned), { rubric })).toBe(0)
  })

  it('attribution: the number must be linked to the page it came from', () => {
    const target = { rubric, attribution: [{ value: '\\$49', domain: 'pricewatch.dev' }] }
    expect(attribution(out('Team is $49/seat per [PriceWatch](https://pricewatch.dev/nimbus-db) (unofficial).'), target)).toBe(1)
    expect(attribution(out('Team is $49/seat [Pricing](https://nimbusdb.com/pricing).'), target)).toBe(0)
    expect(attribution(out('Team is custom pricing [Pricing](https://nimbusdb.com/pricing).'), target)).toBe(1)
  })

  it('cleanOutput: no malformed links, no future dates (today is 2026-11-11)', () => {
    expect(cleanOutput(out('Announced Nov 9, 2026 [post](https://a.com/x).'))).toBe(1)
    expect(cleanOutput(out('[Pricing](https://a.com/x, checked 2026-11-11)'))).toBe(0)
    expect(cleanOutput(out('Claude Opus announcement (Nov 22, 2026)'))).toBe(0)
    expect(cleanOutput(out('Effective 2026-12-01.'))).toBe(0)
  })
})
