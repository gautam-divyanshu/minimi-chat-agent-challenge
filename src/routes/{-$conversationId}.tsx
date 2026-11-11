import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Menu } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAgentStream } from '#/client/useAgentStream'
import { Composer } from '#/components/chat/Composer'
import { Message } from '#/components/chat/Message'
import { Sidebar, type ConversationSummary } from '#/components/chat/Sidebar'
import { Button } from '#/components/ui/button'

// One route for "/" (new chat) and "/:id": the page stays mounted when a new
// chat gets its id, so the live stream isn't interrupted.
export const Route = createFileRoute('/{-$conversationId}')({ component: ChatPage })

const EXAMPLES = [
  'Compare the cheapest paid plans of Neon, Supabase and PlanetScale right now.',
  'What did I ask you on 3 November? Is your answer still correct today?',
  'Has HubSpot shipped anything big since Monday?',
]

function ChatPage() {
  const { conversationId } = Route.useParams()
  const navigate = useNavigate()
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const refresh = useCallback(() => {
    fetch('/api/conversations')
      .then((r) => r.json())
      .then(setConversations)
      .catch(() => {})
  }, [])
  useEffect(refresh, [refresh])

  const onCreated = useCallback(
    (id: string) => {
      navigate({ to: '/{-$conversationId}', params: { conversationId: id }, replace: true })
      refresh()
    },
    [navigate, refresh],
  )
  const { messages, loading, streaming, send, stop } = useAgentStream({ conversationId, onCreated, onTurnDone: refresh })

  // Follow the stream while the user is at the bottom; don't yank them back if they scrolled up.
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useEffect(() => {
    const el = scrollRef.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const active = conversations.find((c) => c.id === conversationId)

  return (
    <div className="flex h-dvh">
      <aside className="hidden w-64 shrink-0 border-r border-sidebar-border md:block">
        <Sidebar conversations={conversations} activeId={conversationId} />
      </aside>
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-sidebar-border shadow-xl">
            <Sidebar conversations={conversations} activeId={conversationId} onNavigate={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 md:px-6">
          <Button variant="ghost" size="icon" className="size-8 md:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">
            <Menu className="size-4" />
          </Button>
          <h1 className="truncate text-sm font-medium">{active?.title ?? (conversationId ? '' : 'New chat')}</h1>
        </header>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          }}
        >
          <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
            {loading ? (
              <div className="space-y-3">
                <div className="ml-auto h-10 w-2/3 animate-pulse rounded-2xl bg-muted" />
                <div className="h-24 w-full animate-pulse rounded-lg bg-muted" />
              </div>
            ) : messages.length === 0 ? (
              <div className="pt-[18vh] text-center">
                <h2 className="text-2xl font-semibold tracking-tight">What do you want to know?</h2>
                <p className="mt-2 text-sm text-muted-foreground">I search the live web, cite sources with dates, and remember our past conversations.</p>
                <div className="mx-auto mt-8 grid max-w-xl gap-2">
                  {EXAMPLES.map((q) => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                      className="rounded-xl border bg-card px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-8">
                {messages.map((m) => (
                  <Message key={m.key} message={m} />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4 md:px-6">
          <Composer
            streaming={streaming}
            onStop={stop}
            onSend={(t) => {
              pinned.current = true
              send(t)
            }}
          />
          <p className="mt-2 text-center text-[11px] text-muted-foreground">Answers can be wrong. Check the sources.</p>
        </div>
      </main>
    </div>
  )
}
