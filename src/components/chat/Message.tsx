import { memo } from 'react'
import type { ChatMessage } from '#/client/useAgentStream'
import { Markdown } from './Markdown'
import { Sources, ToolCalls } from './ToolCalls'

export const Message = memo(function Message({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-secondary px-4 py-2.5 text-sm text-secondary-foreground">
          {message.text}
        </div>
      </div>
    )
  }
  const thinking = message.status === 'streaming' && !message.text && message.tools.every((t) => t.status === 'done')
  return (
    <div className="min-w-0">
      <ToolCalls tools={message.tools} />
      {thinking && <div className="mb-2 h-4 w-24 animate-pulse rounded bg-muted" />}
      {message.text && <Markdown text={message.text} />}
      {message.status === 'error' && (
        <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {message.error ?? 'Something went wrong.'}
        </p>
      )}
      {message.status !== 'streaming' && <Sources tools={message.tools} text={message.text} />}
    </div>
  )
})
