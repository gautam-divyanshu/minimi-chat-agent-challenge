import { memo, useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cleanCitations } from '#/shared/citations'

// Streaming markdown without re-parsing the whole answer on every token:
// split into top-level blocks and memoize each one. While streaming, only the
// last block changes, so only it re-renders.

function splitBlocks(text: string): string[] {
  const blocks: string[] = []
  let current: string[] = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (!inFence && line.trim() === '' && current.length) {
      blocks.push(current.join('\n'))
      current = []
    } else current.push(line)
  }
  if (current.length) blocks.push(current.join('\n'))
  return blocks
}

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
}

const Block = memo(function Block({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  )
})

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => splitBlocks(cleanCitations(text)), [text])
  return (
    <div className="prose prose-sm prose-zinc max-w-none dark:prose-invert prose-p:my-2 prose-li:my-0.5 prose-ul:my-2 prose-a:font-normal prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline dark:prose-a:text-blue-400 prose-table:my-2 prose-th:text-left">
      {blocks.map((b, i) => (
        <Block key={i} text={b} />
      ))}
    </div>
  )
}
