"use client"

import { useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Cancel01Icon,
  Delete02Icon,
  Folder01Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ChatRow, SpaceRow } from "@/lib/types"
import { SpacePicker } from "./space-picker"
import { useWorkspaceSelection } from "./chat-selection"

export function ChatSelectionBar({
  chats,
  spaces,
  className,
}: {
  chats: ChatRow[]
  spaces: SpaceRow[]
  className?: string
}) {
  const {
    selectedCount,
    selectedIds,
    selecting,
    clearSelection,
    moveSelected,
    requestDeleteSelected,
    animate,
    transition,
  } = useWorkspaceSelection()
  const tween = animate ? transition : { duration: 0 }
  const [moveOpen, setMoveOpen] = useState(false)
  const selectedChats = useMemo(
    () => chats.filter((chat) => selectedIds.has(chat.id)),
    [chats, selectedIds]
  )
  const sharedSpaceId = useMemo(() => {
    if (selectedChats.length === 0) return null
    const first = selectedChats[0]?.space_id ?? null
    return selectedChats.every((chat) => chat.space_id === first) ? first : null
  }, [selectedChats])
  return (
    <AnimatePresence initial={false}>
      {selecting ? (
        <motion.div
          data-testid="chat-selection-bar"
          initial={animate ? { height: 0, opacity: 0 } : false}
          animate={{ height: "auto", opacity: 1 }}
          exit={animate ? { height: 0, opacity: 0 } : { height: 0 }}
          transition={tween}
          className={cn("overflow-hidden", className)}
        >
          <div className="grid w-full gap-2 border-t pt-2">
            <div className="flex min-w-0 items-center gap-2">
              <p
                className={cn(
                  "min-w-0 flex-1 text-sm",
                  selectedCount === 0 ? "text-muted-foreground" : "font-medium"
                )}
              >
                {selectedCount === 0
                  ? "Tap chats to select them"
                  : selectedCount === 1
                    ? "1 chat"
                    : `${selectedCount} chats`}
              </p>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Clear selection"
                onClick={clearSelection}
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  strokeWidth={2}
                  className="size-4"
                />
              </Button>
            </div>
            <AnimatePresence initial={false}>
              {selectedCount > 0 ? (
                <motion.div
                  key="selection-actions"
                  initial={animate ? { height: 0, opacity: 0 } : false}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={animate ? { height: 0, opacity: 0 } : { height: 0 }}
                  transition={tween}
                  className="overflow-hidden"
                >
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => setMoveOpen(true)}
                    >
                      <HugeiconsIcon
                        icon={Folder01Icon}
                        strokeWidth={2}
                        className="size-4"
                      />
                      Move to…
                    </Button>
                    <SpacePicker
                      spaces={spaces}
                      value={sharedSpaceId}
                      triggerLabel="Move to…"
                      open={moveOpen}
                      onOpenChange={setMoveOpen}
                      hideTrigger
                      onSelect={(spaceId) => {
                        moveSelected(spaceId)
                        setMoveOpen(false)
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      className="w-full"
                      onClick={requestDeleteSelected}
                    >
                      <HugeiconsIcon
                        icon={Delete02Icon}
                        strokeWidth={2}
                        className="size-4"
                      />
                      Delete
                    </Button>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
