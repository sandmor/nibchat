"use client"

import { useMemo } from "react"
import Link from "next/link"
import { AnimatePresence, motion } from "motion/react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight01Icon,
  CircleEllipsisIcon,
  Folder01Icon,
  FolderOpenIcon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { siblingSort } from "@/lib/sort-key"
import { parseSpaceSettings, SPACE_SAMPLING_KEYS } from "@/lib/space"
import type { ChatRow, SpaceRow } from "@/lib/types"
import { ChatListItem } from "./chat-list"
import type { SlotMotion } from "./slot-crossfade"

type SpaceNode = SpaceRow & { children: SpaceNode[] }

function buildForest(spaces: SpaceRow[]): SpaceNode[] {
  const byId = new Map<string, SpaceNode>()
  for (const space of spaces) {
    byId.set(space.id, { ...space, children: [] })
  }
  const roots: SpaceNode[] = []
  for (const space of spaces) {
    const node = byId.get(space.id)
    if (!node) continue
    if (space.parent_id && byId.has(space.parent_id)) {
      byId.get(space.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  function sortTree(nodes: SpaceNode[]) {
    nodes.sort(siblingSort)
    for (const node of nodes) sortTree(node.children)
  }
  sortTree(roots)
  return roots
}

function spaceAppliesLocks(settingsJson: string | null) {
  const settings = parseSpaceSettings(settingsJson)
  if (settings.promptStack?.enabled) return true
  if (settings.model?.enabled) return true
  if (settings.reasoning?.enabled) return true
  for (const key of SPACE_SAMPLING_KEYS) {
    if (settings[key]?.enabled) return true
  }
  return Object.values(settings.variables ?? {}).some((slot) => slot.enabled)
}

function SpaceRowView({
  space,
  depth,
  chats,
  spaces,
  expanded,
  activeChatId,
  activeSpaceId,
  compact,
  isDraft,
  animate,
  transition,
  onToggle,
  onDeleteChat,
  onDeleteSpace,
  onCreateChat,
  onCreateSpace,
  onMoveChat,
}: {
  space: SpaceNode
  depth: number
  chats: ChatRow[]
  spaces: SpaceRow[]
  expanded: Set<string>
  activeChatId: string | null
  activeSpaceId: string | null
  compact?: boolean
  isDraft: boolean
  animate: boolean
  transition: SlotMotion
  onToggle: (id: string) => void
  onDeleteChat: (chatId: string) => void
  onDeleteSpace: (spaceId: string) => void
  onCreateChat: (spaceId: string) => void
  onCreateSpace: (parentId: string | null) => void
  onMoveChat: (chatId: string, spaceId: string | null) => void
}) {
  const open = expanded.has(space.id)
  const childChats = chats
    .filter((chat) => chat.space_id === space.id)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
  const active = activeSpaceId === space.id
  const locked = spaceAppliesLocks(space.settings_json)
  const showChildren = open && !compact

  return (
    <div>
      <div
        className={cn(
          "group/row flex min-w-0 items-center rounded-lg",
          "hover:bg-sidebar-accent",
          active && "bg-sidebar-accent"
        )}
        style={{ paddingInlineStart: compact ? undefined : `${depth * 12}px` }}
      >
        {!compact && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0"
            aria-expanded={open}
            aria-label={open ? "Collapse space" : "Expand space"}
            onClick={() => onToggle(space.id)}
          >
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              strokeWidth={2}
              className={cn(
                "size-3.5 transition-transform",
                open && "rotate-90"
              )}
            />
          </Button>
        )}
        <Link
          href={`/space/${space.id}`}
          prefetch={false}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-lg py-2 text-left outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
            compact ? "justify-center px-2" : "px-1"
          )}
          aria-current={active ? "page" : undefined}
        >
          <span className="relative shrink-0">
            <HugeiconsIcon
              icon={open ? FolderOpenIcon : Folder01Icon}
              strokeWidth={2}
              className="size-4 text-muted-foreground"
            />
            {locked ? (
              <span
                className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-primary"
                title="Locks chat settings"
                aria-hidden
              />
            ) : null}
          </span>
          {!compact && (
            <span className="truncate text-sm font-medium">{space.name}</span>
          )}
        </Link>
        {!compact && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="me-1 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
                  aria-label={`${space.name} actions`}
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
              <DropdownMenuItem onClick={() => onCreateChat(space.id)}>
                New chat
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCreateSpace(space.id)}>
                New subspace
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onDeleteSpace(space.id)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <AnimatePresence initial={false}>
        {showChildren ? (
          <motion.div
            key={`${space.id}-children`}
            initial={animate ? { height: 0, opacity: 0 } : false}
            animate={{ height: "auto", opacity: 1 }}
            exit={animate ? { height: 0, opacity: 0 } : { height: 0 }}
            transition={transition}
            className="overflow-hidden"
          >
            {space.children.map((child) => (
              <SpaceRowView
                key={child.id}
                space={child}
                depth={depth + 1}
                chats={chats}
                spaces={spaces}
                expanded={expanded}
                activeChatId={activeChatId}
                activeSpaceId={activeSpaceId}
                isDraft={isDraft}
                animate={animate}
                transition={transition}
                onToggle={onToggle}
                onDeleteChat={onDeleteChat}
                onDeleteSpace={onDeleteSpace}
                onCreateChat={onCreateChat}
                onCreateSpace={onCreateSpace}
                onMoveChat={onMoveChat}
              />
            ))}
            {childChats.map((chat) => (
              <div
                key={chat.id}
                style={{ paddingInlineStart: `${(depth + 1) * 12}px` }}
              >
                <ChatListItem
                  chat={chat}
                  spaces={spaces}
                  active={!isDraft && activeChatId === chat.id}
                  onDelete={onDeleteChat}
                  onMove={(spaceId) => onMoveChat(chat.id, spaceId)}
                />
              </div>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export function SpaceTree({
  spaces,
  chats,
  activeChatId,
  activeSpaceId,
  compact,
  isDraft,
  expanded,
  animate,
  transition,
  onToggle,
  onDeleteChat,
  onDeleteSpace,
  onCreateChat,
  onCreateSpace,
  onMoveChat,
}: {
  spaces: SpaceRow[]
  chats: ChatRow[]
  activeChatId: string | null
  activeSpaceId: string | null
  compact?: boolean
  isDraft: boolean
  expanded: Set<string>
  animate: boolean
  transition: SlotMotion
  onToggle: (id: string) => void
  onDeleteChat: (chatId: string) => void
  onDeleteSpace: (spaceId: string) => void
  onCreateChat: (spaceId: string) => void
  onCreateSpace: (parentId: string | null) => void
  onMoveChat: (chatId: string, spaceId: string | null) => void
}) {
  const forest = useMemo(() => buildForest(spaces), [spaces])
  const ungrouped = chats
    .filter((chat) => !chat.space_id)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))

  return (
    <div className="space-y-1">
      {forest.length === 0 && !compact ? (
        <p className="px-2 py-8 text-center text-sm text-muted-foreground">
          Group chats here. A space can also lock a model, stack, or variables.
        </p>
      ) : null}
      {forest.map((space) => (
        <SpaceRowView
          key={space.id}
          space={space}
          depth={0}
          chats={chats}
          spaces={spaces}
          expanded={expanded}
          activeChatId={activeChatId}
          activeSpaceId={activeSpaceId}
          compact={compact}
          isDraft={isDraft}
          animate={animate}
          transition={transition}
          onToggle={onToggle}
          onDeleteChat={onDeleteChat}
          onDeleteSpace={onDeleteSpace}
          onCreateChat={onCreateChat}
          onCreateSpace={onCreateSpace}
          onMoveChat={onMoveChat}
        />
      ))}
      {ungrouped.length > 0 && !compact && forest.length > 0 ? (
        <p className="px-3 pt-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Ungrouped
        </p>
      ) : null}
      {ungrouped.map((chat) => (
        <ChatListItem
          key={chat.id}
          chat={chat}
          compact={compact}
          spaces={spaces}
          active={!isDraft && activeChatId === chat.id}
          onDelete={onDeleteChat}
          onMove={(spaceId) => onMoveChat(chat.id, spaceId)}
        />
      ))}
    </div>
  )
}
