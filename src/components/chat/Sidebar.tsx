import { Link } from '@tanstack/react-router'
import { SquarePen } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'

export type ConversationSummary = { id: string; title: string | null; updatedAt: number }

export function Sidebar({ conversations, activeId, onNavigate }: { conversations: ConversationSummary[]; activeId?: string; onNavigate?: () => void }) {
  return (
    <nav className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between p-3">
        <span className="px-2 text-sm font-semibold">Chat Agent</span>
        <Button asChild variant="ghost" size="icon" className="size-8" aria-label="New chat">
          <Link to="/{-$conversationId}" params={{ conversationId: undefined }} onClick={onNavigate}>
            <SquarePen className="size-4" />
          </Link>
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {conversations.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">No conversations yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((c) => (
              <li key={c.id}>
                <Link
                  to="/{-$conversationId}"
                  params={{ conversationId: c.id }}
                  onClick={onNavigate}
                  className={cn(
                    'block truncate rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent',
                    c.id === activeId && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
                  )}
                  title={c.title ?? undefined}
                >
                  {c.title || 'Untitled'}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  )
}
