import { mkdirSync, writeFileSync } from 'node:fs'
import { judgeReasons } from './evaluators'

/**
 * Laminar keeps the full results; this prints the part you want in the
 * terminal: which cases lost points and what the agent did. Also writes
 * evals/results/<group>.json (gitignored) for the README table.
 */
type Row = { name: string; scores: Record<string, number>; output: any }
type Evaluator = (output: any, target?: any, data?: any) => number | Promise<number>

const TIMING = /Seconds$/

export function withReport<E extends Record<string, Evaluator>>(group: string, evaluators: E): E {
  const rows = new Map<string, Row>()
  const wrapped = Object.fromEntries(
    Object.entries(evaluators).map(([key, fn]) => [
      key,
      async (output: any, target?: any, data?: any) => {
        const score = await fn(output, target, data)
        const name = data?.name ?? data?.prompt ?? '?'
        const row: Row = rows.get(name) ?? { name, scores: {}, output }
        row.scores[key] = score
        rows.set(name, row)
        return score
      },
    ]),
  ) as E

  process.once('beforeExit', () => {
    const all = [...rows.values()]
    const failed = all.filter((r) => Object.entries(r.scores).some(([k, v]) => !TIMING.test(k) && v < 1))
    console.log(`\n${group}: ${all.length - failed.length}/${all.length} cases with every score at 1`)
    for (const r of failed) {
      const low = Object.entries(r.scores).filter(([k, v]) => !TIMING.test(k) && v < 1)
      console.log(`\n✗ ${r.name}\n  ${low.map(([k, v]) => `${k}=${Number(v.toFixed(2))}`).join('  ')}`)
      for (const c of r.output?.toolCalls ?? []) {
        const { objective: _objective, ...args } = c.args ?? {}
        console.log(`  call: ${c.toolName} ${JSON.stringify(args)}`)
      }
      const text = r.output?.answer ?? r.output?.text
      if (text) console.log(`  answer: ${String(text).replace(/\s+/g, ' ').slice(0, 600)}`)
      const reason = judgeReasons.get(r.output?.answer)
      if (reason && (r.scores.judge ?? 1) < 1) console.log(`  judge: ${reason.replace(/\s+/g, ' ').slice(0, 400)}`)
    }
    mkdirSync('evals/results', { recursive: true })
    writeFileSync(`evals/results/${group}.json`, JSON.stringify(all.map(({ name, scores }) => ({ name, scores })), null, 2))
  })
  return wrapped
}
