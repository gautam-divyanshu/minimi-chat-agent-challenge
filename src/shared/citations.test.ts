import { describe, expect, it } from 'vitest'
import { cleanCitations } from './citations'

describe('cleanCitations', () => {
  it('drops text the model put after the URL', () => {
    expect(cleanCitations('see [Supabase Pricing](https://supabase.com/pricing, checked 2026-11-11) and [Billing](https://supabase.com/docs/billing; Nov 2026).')).toBe(
      'see [Supabase Pricing](https://supabase.com/pricing) and [Billing](https://supabase.com/docs/billing).',
    )
    expect(cleanCitations('[A](https://a.com/x (checked 2026-11-11))')).toBe('[A](https://a.com/x)')
  })

  it('leaves valid links and other text alone', () => {
    const ok = 'Pro is $25 [Pricing](https://supabase.com/pricing). Call f(x, y) and see [docs](https://a.com/b?c=1,2).'
    expect(cleanCitations(ok)).toBe(ok)
  })

  it('handles a link still being streamed', () => {
    const partial = 'Pro is $25 [Pricing](https://supabase.com/pricing, chec'
    expect(cleanCitations(partial)).toBe(partial)
  })
})
