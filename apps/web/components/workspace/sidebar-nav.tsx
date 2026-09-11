"use client"

import Link from "next/link"
import { motion } from "motion/react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Add01Icon, FolderAddIcon } from "@hugeicons/core-free-icons"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TooltipProvider, WithTooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { displayChatTitle } from "@/lib/chat-title"
import type { ChatRow, SpaceRow } from "@/lib/types"
import { ChatListItem } from "./chat-list"
import { SpaceTree } from "./space-tree"
import type { SlotMotion } from "./slot-crossfade"

type SearchHit = {
  id: string
  chat_id: string
  search_text: string | null
  title: string | null
}

export function SidebarNav({
  chats,
  spaces,
  spaceById,
  search,
  onSearchChange,
  results,
  listMode,
  onListMode,
  collapsed = false,
  activeChatId,
  activeSpaceId,
  isDraft,
  expandedSpaces,
  animate,
  transition,
  onToggleSpace,
  onDeleteChat,
  onDeleteSpace,
  onCreateSpace,
  onCreateChat,
  onMoveChat,
  onNavigate,
}: {
  chats: ChatRow[]
  spaces: SpaceRow[]
  spaceById: Map<string, SpaceRow>
  search: string
  onSearchChange: (value: string) => void
  results: SearchHit[]
  listMode: "recents" | "spaces"
  onListMode: (mode: "recents" | "spaces") => void
  collapsed?: boolean
  activeChatId: string | null
  activeSpaceId: string | null
  isDraft: boolean
  expandedSpaces: Set<string>
  animate: boolean
  transition: SlotMotion
  onToggleSpace: (id: string) => void
  onDeleteChat: (id: string) => void
  onDeleteSpace: (id: string) => void
  onCreateSpace: (parentId?: string) => void
  onCreateChat: (spaceId: string) => void
  onMoveChat: (chatId: string, spaceId: string | null) => void
  onNavigate?: () => void
}) {
  const showSpaces = listMode === "spaces" && !collapsed

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onClick={(event) => {
        const target = event.target as HTMLElement | null
        if (target?.closest("a")) onNavigate?.()
      }}
    >
      <TooltipProvider delay={400}>
        {!collapsed ? (
          <>
            <Link
              href="/chat/new"
              data-theme-group="button"
              data-theme-target="button"
              onClick={onNavigate}
              className={cn(buttonVariants(), "mb-3 w-full gap-1.5")}
            >
              <HugeiconsIcon
                icon={Add01Icon}
                strokeWidth={2}
                className="size-4"
                aria-hidden
              />
              New conversation
            </Link>
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search every branch"
              aria-label="Search every branch"
              className="mb-2"
            />
          </>
        ) : (
          <WithTooltip label="New conversation" side="right">
            <Link
              href="/chat/new"
              data-theme-group="button"
              data-theme-target="button"
              className={cn(buttonVariants({ size: "icon" }), "mb-2 w-full")}
              aria-label="New conversation"
            >
              <HugeiconsIcon
                icon={Add01Icon}
                strokeWidth={2}
                className="size-4"
                aria-hidden
              />
            </Link>
          </WithTooltip>
        )}
        {results.length > 0 && !collapsed ? (
          <div className="mb-2 max-h-40 overflow-y-auto overscroll-contain rounded-lg border bg-background">
            <div className="space-y-1 p-1">
              {results.map((result) => (
                <Link
                  key={result.id}
                  href={`/chat/${result.chat_id}?node=${encodeURIComponent(result.id)}`}
                  onClick={() => {
                    onSearchChange("")
                    onNavigate?.()
                  }}
                  className={cn(
                    buttonVariants({ variant: "ghost" }),
                    "h-auto w-full flex-col items-start gap-0.5 px-2 py-2 text-left"
                  )}
                >
                  <span className="font-medium">
                    {displayChatTitle(result.title)}
                  </span>
                  <span className="w-full truncate text-xs text-muted-foreground">
                    {result.search_text}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ) : null}
        {!collapsed ? (
          <div className="mb-2 flex items-center gap-1">
            <ToggleGroup
              value={[listMode]}
              onValueChange={(value) => {
                const next = value[0]
                if (next === "recents" || next === "spaces") onListMode(next)
              }}
              variant="outline"
              size="sm"
              spacing={0}
              className="min-w-0 flex-1"
            >
              <ToggleGroupItem value="recents" className="flex-1">
                Recents
              </ToggleGroupItem>
              <ToggleGroupItem value="spaces" className="flex-1">
                Spaces
              </ToggleGroupItem>
            </ToggleGroup>
            <WithTooltip label="New space">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="shrink-0"
                aria-label="New space"
                onClick={() => onCreateSpace()}
              >
                <HugeiconsIcon
                  icon={FolderAddIcon}
                  strokeWidth={2}
                  className="size-4"
                />
              </Button>
            </WithTooltip>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <motion.div
            key={showSpaces ? "spaces" : "recents"}
            initial={animate ? { opacity: 0, y: 8 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={transition}
          >
            {showSpaces ? (
              <SpaceTree
                spaces={spaces}
                chats={chats}
                activeChatId={activeChatId}
                activeSpaceId={activeSpaceId}
                compact={collapsed}
                isDraft={isDraft}
                expanded={expandedSpaces}
                animate={animate}
                transition={transition}
                onToggle={onToggleSpace}
                onDeleteChat={onDeleteChat}
                onDeleteSpace={onDeleteSpace}
                onCreateChat={(spaceId) => {
                  onCreateChat(spaceId)
                  onNavigate?.()
                }}
                onCreateSpace={(parentId) =>
                  onCreateSpace(parentId ?? undefined)
                }
                onMoveChat={onMoveChat}
              />
            ) : (
              <div className="space-y-1">
                {chats.map((chat) => (
                  <ChatListItem
                    key={chat.id}
                    chat={chat}
                    compact={collapsed}
                    spaceName={
                      chat.space_id ? spaceById.get(chat.space_id)?.name : null
                    }
                    active={!isDraft && activeChatId === chat.id}
                    spaces={spaces}
                    onMove={(spaceId) => onMoveChat(chat.id, spaceId)}
                    onDelete={onDeleteChat}
                  />
                ))}
              </div>
            )}
          </motion.div>
        </div>
      </TooltipProvider>
    </div>
  )
}
