"use client"

import { useState } from "react"
import Link from "next/link"
import { AnimatePresence, motion } from "motion/react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  CheckListIcon,
  CircleEllipsisIcon,
  Delete02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { WithTooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { ChatRow, SpaceRow } from "@/lib/types"
import { displayChatTitle } from "@/lib/chat-title"
import {
  isChatSelectGesture,
  useChatPressSelect,
  useOptionalWorkspaceSelection,
} from "./chat-selection"
import { ChatDraggable } from "./space-dnd"
import { SpacePicker } from "./space-picker"

export function ChatSelectToggle({
  className,
  size = "sm",
  icon = false,
}: {
  className?: string
  size?: "xs" | "sm"
  icon?: boolean
}) {
  const selection = useOptionalWorkspaceSelection()
  if (!selection) return null
  const { selecting, enterSelecting, clearSelection, animate, transition } =
    selection
  const label = selecting ? "Done" : "Select"
  const button = (
    <Button
      type="button"
      variant={selecting ? "default" : "outline"}
      size={icon ? "icon-sm" : size}
      className={className}
      aria-label={icon ? label : undefined}
      aria-pressed={selecting}
      onClick={(event) => {
        event.stopPropagation()
        selecting ? clearSelection() : enterSelecting()
      }}
    >
      {icon ? (
        <HugeiconsIcon
          icon={CheckListIcon}
          strokeWidth={2}
          className="size-4"
        />
      ) : (
        <span className="relative inline-grid justify-items-center">
          <AnimatePresence initial={false}>
            <motion.span
              key={label}
              initial={animate ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              exit={animate ? { opacity: 0 } : undefined}
              transition={animate ? transition : { duration: 0 }}
              className="col-start-1 row-start-1"
            >
              {label}
            </motion.span>
          </AnimatePresence>
        </span>
      )}
    </Button>
  )
  if (icon) return <WithTooltip label={label}>{button}</WithTooltip>
  return button
}

export function ChatSelectMark({
  selected,
  visible,
}: {
  selected: boolean
  visible: boolean
}) {
  const motionPrefs = useOptionalWorkspaceSelection()
  const animate = motionPrefs?.animate ?? false
  const tween = animate
    ? motionPrefs?.transition
    : { duration: 0, ease: [0, 0, 0, 1] as [number, number, number, number] }
  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.span
          initial={animate ? { width: 0, opacity: 0 } : false}
          animate={{ width: "1.5rem", opacity: 1 }}
          exit={animate ? { width: 0, opacity: 0 } : { width: 0 }}
          transition={tween}
          className="inline-flex shrink-0 items-center overflow-hidden"
          aria-hidden
        >
          <span
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground/40"
            )}
          >
            <AnimatePresence initial={false}>
              {selected ? (
                <motion.span
                  key="tick"
                  initial={animate ? { opacity: 0, scale: 0.7 } : false}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={animate ? { opacity: 0, scale: 0.7 } : { opacity: 0 }}
                  transition={tween}
                  className="flex origin-center"
                >
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    strokeWidth={2}
                    className="size-2.5"
                  />
                </motion.span>
              ) : null}
            </AnimatePresence>
          </span>
        </motion.span>
      ) : null}
    </AnimatePresence>
  )
}

export function ChatListItem({
  chat,
  active,
  compact,
  spaceName,
  spaces,
  orderedIds,
  draggable,
  onMove,
  onDelete,
}: {
  chat: ChatRow
  active: boolean
  compact?: boolean
  spaceName?: string | null
  spaces?: SpaceRow[]
  orderedIds?: readonly string[]
  draggable?: boolean
  onMove?: (spaceId: string | null) => void
  onDelete: (chatId: string) => void
}) {
  const title = displayChatTitle(chat.title)
  const [moveOpen, setMoveOpen] = useState(false)
  const selection = useOptionalWorkspaceSelection()
  const selected = selection?.isSelected(chat.id) ?? false
  const selecting = selection?.selecting ?? false
  const animate = selection?.animate ?? false
  const transition = selection?.transition
  const canSelect = Boolean(selection && orderedIds && !compact)
  const press = useChatPressSelect(chat.id, canSelect)

  const selectLink = (
    <Link
      href={`/chat/${chat.id}`}
      prefetch={false}
      className={cn(
        "min-w-0 flex-1 rounded-lg py-2 text-left outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
        compact ? "px-2" : selecting ? "px-2" : "px-3"
      )}
      aria-label={compact ? title : undefined}
      aria-current={active && !selecting ? "page" : undefined}
      aria-selected={selected || undefined}
      onPointerDown={press.onPointerDown}
      onPointerMove={press.onPointerMove}
      onPointerUp={press.onPointerUp}
      onPointerCancel={press.onPointerCancel}
      onContextMenu={press.onContextMenu}
      onClick={(event) => {
        if (press.consumeClick()) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (!selection || !orderedIds || compact) return
        if (!selecting && !isChatSelectGesture(event)) return
        event.preventDefault()
        event.stopPropagation()
        selection.selectChat(chat.id, event, orderedIds)
      }}
    >
      {compact ? (
        <span className="block w-full truncate text-center text-xs" aria-hidden>
          {title.slice(0, 2)}
        </span>
      ) : (
        <span className="flex min-w-0 items-center">
          <ChatSelectMark selected={selected} visible={selecting} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm font-medium">{title}</span>
            <span className="text-xs text-muted-foreground">
              {spaceName
                ? `${spaceName} · ${new Date(chat.updated_at).toLocaleDateString()}`
                : new Date(chat.updated_at).toLocaleDateString()}
            </span>
          </span>
        </span>
      )}
    </Link>
  )

  const deleteButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn(
        "me-1.5 shrink-0 text-muted-foreground",
        "hover:bg-sidebar hover:text-destructive",
        "opacity-70 group-hover/row:opacity-100"
      )}
      aria-label={`Delete ${title}`}
      onClick={(event) => {
        event.preventDefault()
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
    </Button>
  )

  const actions =
    compact || !(onMove && spaces) ? (
      compact ? null : (
        <WithTooltip label="Delete conversation">{deleteButton}</WithTooltip>
      )
    ) : (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="me-1 shrink-0 opacity-70 group-hover/row:opacity-100"
                aria-label={`${title} actions`}
              />
            }
          >
            <HugeiconsIcon
              icon={CircleEllipsisIcon}
              strokeWidth={2}
              className="size-4"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            {canSelect ? (
              <DropdownMenuItem
                onClick={() => selection?.enterSelecting([chat.id])}
              >
                Select
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={() => setMoveOpen(true)}>
              Move to…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onDelete(chat.id)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <SpacePicker
          spaces={spaces}
          value={chat.space_id}
          triggerLabel="Move to…"
          open={moveOpen}
          onOpenChange={setMoveOpen}
          hideTrigger
          onSelect={(spaceId) => {
            onMove(spaceId)
            setMoveOpen(false)
          }}
        />
      </>
    )

  const row = (
    <div
      className={cn(
        "group/row flex min-w-0 items-center rounded-lg",
        "hover:bg-sidebar-accent",
        (active || selected) && "bg-sidebar-accent",
        selected && "ring-1 ring-sidebar-ring"
      )}
    >
      {compact ? (
        <WithTooltip label={title} side="right">
          {selectLink}
        </WithTooltip>
      ) : (
        selectLink
      )}
      <AnimatePresence initial={false}>
        {!selecting && actions ? (
          <motion.div
            key="row-actions"
            initial={animate ? { width: 0, opacity: 0 } : false}
            animate={{ width: "auto", opacity: 1 }}
            exit={animate ? { width: 0, opacity: 0 } : { width: 0 }}
            transition={animate ? transition : { duration: 0 }}
            className="flex shrink-0 overflow-hidden"
          >
            {actions}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
  if (compact || !draggable) return row
  return (
    <ChatDraggable chatId={chat.id} disabled={selecting}>
      {row}
    </ChatDraggable>
  )
}
