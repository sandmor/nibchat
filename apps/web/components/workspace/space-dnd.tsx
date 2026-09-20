"use client"

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  pointerWithin,
  type CollisionDetection,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"
import { idsForMove, useWorkspaceSelection } from "./chat-selection"

const CHAT_DRAG_PREFIX = "chat:"
const SPACE_DROP_PREFIX = "space:"
const UNGROUPED_DROP_ID = "space:ungrouped"

function chatDragId(chatId: string) {
  return `${CHAT_DRAG_PREFIX}${chatId}`
}

function spaceDropId(spaceId: string | null) {
  return spaceId ? `${SPACE_DROP_PREFIX}${spaceId}` : UNGROUPED_DROP_ID
}

function parseChatDragId(id: UniqueIdentifier | undefined) {
  if (typeof id !== "string" || !id.startsWith(CHAT_DRAG_PREFIX)) return null
  return id.slice(CHAT_DRAG_PREFIX.length)
}

function parseSpaceDropId(id: UniqueIdentifier | undefined) {
  if (typeof id !== "string" || !id.startsWith(SPACE_DROP_PREFIX)) {
    return undefined
  }
  if (id === UNGROUPED_DROP_ID) return null
  return id.slice(SPACE_DROP_PREFIX.length)
}

const spaceCollisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  if (hits.length <= 1) return hits
  return [...hits]
    .sort((left, right) => {
      const leftRect = args.droppableRects.get(left.id)
      const rightRect = args.droppableRects.get(right.id)
      if (!leftRect || !rightRect) return 0
      return (
        leftRect.width * leftRect.height - rightRect.width * rightRect.height
      )
    })
    .slice(0, 1)
}

export function ChatDraggable({
  chatId,
  disabled,
  className,
  children,
}: {
  chatId: string
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: chatDragId(chatId),
    data: { type: "chat", chatId },
    disabled,
  })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        className,
        !disabled && "select-none",
        isDragging && "opacity-50"
      )}
      {...(disabled ? {} : listeners)}
      {...(disabled ? {} : attributes)}
    >
      {children}
    </div>
  )
}

export function SpaceDroppable({
  spaceId,
  className,
  children,
}: {
  spaceId: string | null
  className?: string
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: spaceDropId(spaceId),
    data: { type: "space", spaceId },
  })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        className,
        isOver && "rounded-lg bg-sidebar-accent ring-1 ring-ring/40 ring-inset"
      )}
    >
      {children}
    </div>
  )
}

export function WorkspaceDnd({
  children,
  onMoveChats,
  id = "workspace-spaces",
}: {
  children: ReactNode
  onMoveChats: (chatIds: string[], spaceId: string | null) => void
  id?: string
}) {
  const { selectedIds } = useWorkspaceSelection()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  function onDragEnd(event: DragEndEvent) {
    const chatId = parseChatDragId(event.active.id)
    if (!chatId || !event.over) return
    const spaceId = parseSpaceDropId(event.over.id)
    if (spaceId === undefined) return
    const chatIds = idsForMove(chatId, selectedIds)
    onMoveChats(chatIds, spaceId)
  }

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={spaceCollisionDetection}
      onDragEnd={onDragEnd}
    >
      {children}
    </DndContext>
  )
}
