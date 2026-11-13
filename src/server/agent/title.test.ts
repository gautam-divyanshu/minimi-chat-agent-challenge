import { describe, expect, it } from 'vitest'
import { cleanTitle } from './title'

describe('cleanTitle', () => {
  it('strips quotes, Markdown, labels and trailing punctuation', () => {
    expect(cleanTitle('"Postgres Hosting Prices."')).toBe('Postgres Hosting Prices')
    expect(cleanTitle('**Title:** CRM tools for sales teams\nSecond line')).toBe('CRM tools for sales teams')
    expect(cleanTitle("'Node.js latest version'")).toBe('Node.js latest version')
  })

  it('caps the length and rejects empty output', () => {
    expect(cleanTitle('a'.repeat(100))!.length).toBe(60)
    expect(cleanTitle('  \n')).toBeNull()
  })
})
