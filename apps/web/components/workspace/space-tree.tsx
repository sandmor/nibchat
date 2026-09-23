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
import { parseSpaceSettings, spacePolicyImpact } from "@/lib/spaces"
import type { ChatRow, SpaceRow } from "@/lib/types"
import { ChatListItem } from "./chat-list"
import { SpaceDroppable } from "./space-dnd"
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

function chatsInSpace(chats: ChatRow[], spaceId: string | null) {
  return chats
    .filter((chat) => (spaceId ? chat.space_id === spaceId : !chat.space_id))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
}

function visibleSpaceTreeChatIds(
  spaces: SpaceRow[],
  chats: ChatRow[],
  expanded: Set<string>
): string[] {
  const forest = buildForest(spaces)
  const ids: string[] = []
  function walk(node: SpaceNode) {
    if (!expanded.has(node.id)) return
    for (const child of node.children) walk(child)
    for (const chat of chatsInSpace(chats, node.id)) ids.push(chat.id)
  }
  for (const root of forest) walk(root)
  for (const chat of chatsInSpace(chats, null)) ids.push(chat.id)
  return ids
}

function spaceAppliesLocks(settingsJson: string | null) {
  const impact = spacePolicyImpact(parseSpaceSettings(settingsJson))
  return (
    impact.settings.length + impact.variables + impact.books + impact.rules > 0
  )
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
  orderedIds,
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
  orderedIds: string[]
}) {
  const open = expanded.has(space.id)
  const childChats = chatsInSpace(chats, space.id)
  const active = activeSpaceId === space.id
  const locked = spaceAppliesLocks(space.settings_json)
  const showChildren = open && !compact

  return (
    <div>
      <SpaceDroppable spaceId={space.id}>
        <div
          className={cn(
            "group/row flex min-w-0 items-center rounded-lg",
            "hover:bg-sidebar-accent",
            active && "bg-sidebar-accent",
            "has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring/50 has-[a:focus-visible]:ring-inset"
          )}
          style={{
            paddingInlineStart: compact ? undefined : `${depth * 12}px`,
          }}
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
                  title="Applies chat settings"
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
      </SpaceDroppable>
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
                orderedIds={orderedIds}
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
                  orderedIds={orderedIds}
                  draggable={!compact}
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
  const orderedIds = useMemo(
    () => visibleSpaceTreeChatIds(spaces, chats, expanded),
    [spaces, chats, expanded]
  )
  const ungrouped = chatsInSpace(chats, null)

  return (
    <div className="space-y-1">
      {forest.length === 0 && !compact ? (
        <p className="px-2 py-8 text-center text-sm text-muted-foreground">
          Group chats here. A space can also set a model, stack, rules, or
          variables.
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
          orderedIds={orderedIds}
        />
      ))}
      {ungrouped.length > 0 && !compact && forest.length > 0 ? (
        <SpaceDroppable spaceId={null}>
          <p className="px-3 pt-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Ungrouped
          </p>
        </SpaceDroppable>
      ) : null}
      {ungrouped.map((chat) => (
        <ChatListItem
          key={chat.id}
          chat={chat}
          compact={compact}
          spaces={spaces}
          active={!isDraft && activeChatId === chat.id}
          orderedIds={orderedIds}
          draggable={!compact}
          onDelete={onDeleteChat}
          onMove={(spaceId) => onMoveChat(chat.id, spaceId)}
        />
      ))}
    </div>
  )
}
