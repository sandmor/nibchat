"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { Delete02Icon } from "@hugeicons/core-free-icons"
import { WithTooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { ChatRow } from "@/lib/types"

export function ChatListItem({
  chat,
  active,
  compact,
  onSelect,
  onDelete,
}: {
  chat: ChatRow
  active: boolean
  compact?: boolean
  onSelect: (chatId: string) => void
  onDelete: (chatId: string) => void
}) {
  const selectButton = (
    <button
      type="button"
      className={cn(
        "min-w-0 flex-1 rounded-lg py-2 text-left outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
        compact ? "px-2" : "px-3"
      )}
      onClick={() => onSelect(chat.id)}
      aria-label={compact ? chat.title : undefined}
      aria-current={active ? "true" : undefined}
    >
      {compact ? (
        <span className="block w-full truncate text-center text-xs" aria-hidden>
          {chat.title.slice(0, 2)}
        </span>
      ) : (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{chat.title}</span>
          <span className="text-xs text-muted-foreground">
            {new Date(chat.updated_at).toLocaleDateString()}
          </span>
        </span>
      )}
    </button>
  )

  const deleteButton = (
    <button
      type="button"
      className={cn(
        "me-1.5 flex size-8 shrink-0 items-center justify-center rounded-md",
        "text-muted-foreground outline-none",
        "hover:bg-sidebar hover:text-destructive",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        "opacity-70 group-hover/row:opacity-100"
      )}
      aria-label={`Delete ${chat.title}`}
      onClick={(event) => {
        event.stopPropagation()
        onDelete(chat.id)
      }}
    >
      <HugeiconsIcon
        icon={Delete02Icon}
        strokeWidth={2}
        className="size-4"
        aria-hidden
      />
    </button>
  )

  return (
    <div
      className={cn(
        "group/row flex min-w-0 items-center rounded-lg",
        "hover:bg-sidebar-accent",
        active && "bg-sidebar-accent"
      )}
    >
      {compact ? (
        <WithTooltip label={chat.title} side="right">
          {selectButton}
        </WithTooltip>
      ) : (
        selectButton
      )}
      {!compact && (
        <WithTooltip label="Delete conversation">{deleteButton}</WithTooltip>
      )}
    </div>
  )
}
