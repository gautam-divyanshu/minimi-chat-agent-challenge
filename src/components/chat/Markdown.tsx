import { createContext, isValidElement, memo, useContext, useMemo, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
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

/** url → { n, title }: links to these render as numbered citation pills. */
export type CitationMap = Map<string, { n: number; title: string }>
const Citations = createContext<CitationMap | undefined>(undefined)

export const normalizeUrl = (url: string) => url.replace(/\/$/, '')

function Link({ href, children }: { href?: string; children?: React.ReactNode }) {
  const cite = useContext(Citations)?.get(normalizeUrl(href ?? ''))
  if (cite) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        title={cite.title}
        className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-muted px-1 align-[0.15em] text-[10px] font-medium text-muted-foreground no-underline hover:bg-primary hover:text-primary-foreground"
      >
        {cite.n}
      </a>
    )
  }
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  )
}

/** A fenced code block: language label, copy button, highlighted code. */
function CodeBlock({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const className = isValidElement<{ className?: string }>(children) ? (children.props.className ?? '') : ''
  const language = /language-([\w+#-]+)/.exec(className)?.[1] ?? 'text'
  const copy = () => {
    void navigator.clipboard.writeText(ref.current?.textContent ?? '').then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="not-prose my-3 overflow-hidden rounded-lg border bg-muted/60">
      <div className="flex items-center justify-between border-b px-3 py-1 text-xs text-muted-foreground">
        <span>{language}</span>
        <button type="button" onClick={copy} className="rounded px-1.5 py-0.5 hover:bg-background hover:text-foreground">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre ref={ref} className="overflow-x-auto p-3 font-mono text-[13px] leading-relaxed">
        {children}
      </pre>
    </div>
  )
}

const components: Components = {
  a: Link,
  pre: CodeBlock,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
}

// Only blocks that name a language are coloured; guessing mis-colours plain text.
const rehypePlugins = [rehypeHighlight]

const Block = memo(function Block({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={components}>
      {text}
    </ReactMarkdown>
  )
})

/**
 * `citations` is only passed once the answer is complete: numbering depends on
 * the whole text, and changing it mid-stream would re-render every block.
 */
export function Markdown({ text, citations }: { text: string; citations?: CitationMap }) {
  const blocks = useMemo(() => splitBlocks(cleanCitations(text)), [text])
  return (
    <Citations.Provider value={citations}>
      <div className="prose prose-sm prose-zinc max-w-none dark:prose-invert prose-p:my-2 prose-li:my-0.5 prose-ul:my-2 prose-ol:my-2 prose-headings:mt-4 prose-headings:mb-2 prose-a:font-normal prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline dark:prose-a:text-blue-400 prose-table:my-2 prose-th:text-left prose-pre:my-3 prose-pre:rounded-lg prose-pre:border prose-pre:bg-muted prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none prose-code:font-medium">
        {blocks.map((b, i) => (
          <Block key={i} text={b} />
        ))}
      </div>
    </Citations.Provider>
  )
}
