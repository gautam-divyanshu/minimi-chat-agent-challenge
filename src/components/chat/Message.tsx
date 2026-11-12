import { memo, useMemo } from 'react'
import type { ChatMessage } from '#/client/useAgentStream'
import { Markdown } from './Markdown'
import { buildCitations, Sources, ToolCalls, uniqueSources } from './ToolCalls'

export const Message = memo(function Message({ message }: { message: ChatMessage }) {
  const done = message.status !== 'streaming'
  // Numbering needs the whole answer, so it is computed once streaming ends.
  const citations = useMemo(
    () => (done && message.role === 'assistant' ? buildCitations(message.text, uniqueSources(message.tools)) : undefined),
    [done, message.role, message.text, message.tools],
  )

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-secondary px-4 py-2.5 text-sm text-secondary-foreground">
          {message.text}
        </div>
      </div>
    )
  }
  const toolsDone = message.tools.every((t) => t.status === 'done')
  const thinking = message.status === 'streaming' && !message.text && toolsDone
  return (
    <div className="min-w-0">
      <ToolCalls tools={message.tools} collapsed={toolsDone && (done || message.text !== '')} />
      {thinking && <div className="mb-2 h-4 w-24 animate-pulse rounded bg-muted" />}
      {message.text && <Markdown text={message.text} citations={citations?.map} />}
      {message.status === 'error' && (
        <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {message.error ?? 'Something went wrong.'}
        </p>
      )}
      {message.status === 'interrupted' && (
        <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          This answer was interrupted because the server restarted. Ask again to get a complete answer.
        </p>
      )}
      {citations && <Sources cited={citations.cited} />}
    </div>
  )
})
