import { ArrowUp, Square } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'

export function Composer({ onSend, onStop, streaming }: { onSend: (text: string) => void; onStop: () => void; streaming: boolean }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const submit = () => {
    const t = text.trim()
    if (!t || streaming) return
    onSend(t)
    setText('')
    ref.current?.focus()
  }
  return (
    <form
      className="relative rounded-2xl border bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring/40"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Textarea
        ref={ref}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder="Ask anything. I can search the web and remember our past chats."
        rows={1}
        className="max-h-48 min-h-12 resize-none border-0 bg-transparent py-3.5 pr-14 pl-4 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      {streaming ? (
        <Button type="button" size="icon" variant="secondary" onClick={onStop} className="absolute right-2 bottom-2 size-8 rounded-full" aria-label="Stop">
          <Square className="size-3.5 fill-current" />
        </Button>
      ) : (
        <Button type="submit" size="icon" disabled={!text.trim()} className="absolute right-2 bottom-2 size-8 rounded-full" aria-label="Send">
          <ArrowUp className="size-4" />
        </Button>
      )}
    </form>
  )
}
