/**
 * Repair citation links the model wrote with extra text inside the
 * parentheses, e.g. `[Pricing](https://x.com/pricing, checked 2026-11-11)`.
 * A space in the destination makes it not a link at all in markdown, so the
 * reader would see raw brackets. Keep the URL, drop the rest.
 */
export function cleanCitations(text: string): string {
  return text.replace(/\]\(\s*<?(https?:\/\/[^\s)>]+?)>?[,;]?\s+(?:[^()]|\([^)]*\))*\)/g, ']($1)')
}
