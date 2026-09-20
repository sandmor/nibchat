"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { ChatRow } from "@/lib/types"
import type { SlotMotion } from "./slot-crossfade"

export type ChatSelectKeys = {
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}

export function idsForMove(
  chatId: string,
  selected: ReadonlySet<string>
): string[] {
  if (selected.has(chatId)) return [...selected]
  return [chatId]
}

function applyChatSelection(
  current: ReadonlySet<string>,
  chatId: string,
  keys: ChatSelectKeys,
  orderedIds: readonly string[],
  anchorId: string | null
): { selected: Set<string>; anchor: string } {
  const additive = keys.metaKey || keys.ctrlKey
  if (keys.shiftKey) {
    const anchor = anchorId && orderedIds.includes(anchorId) ? anchorId : chatId
    const start = orderedIds.indexOf(anchor)
    const end = orderedIds.indexOf(chatId)
    const range =
      start === -1 || end === -1
        ? [chatId]
        : orderedIds.slice(Math.min(start, end), Math.max(start, end) + 1)
    if (additive) {
      const next = new Set(current)
      for (const id of range) next.add(id)
      return { selected: next, anchor }
    }
    return { selected: new Set(range), anchor }
  }
  const next = new Set(current)
  if (next.has(chatId)) next.delete(chatId)
  else next.add(chatId)
  return { selected: next, anchor: chatId }
}

export function isChatSelectGesture(keys: ChatSelectKeys) {
  return keys.metaKey || keys.ctrlKey || keys.shiftKey
}

type WorkspaceSelectionValue = {
  selecting: boolean
  selectedIds: ReadonlySet<string>
  selectedCount: number
  isSelected: (chatId: string) => boolean
  selectChat: (
    chatId: string,
    keys: ChatSelectKeys,
    orderedIds: readonly string[]
  ) => void
  setSelectedIds: (chatIds: readonly string[]) => void
  enterSelecting: (chatIds?: readonly string[]) => void
  clearSelection: () => void
  moveSelected: (spaceId: string | null) => void
  requestDeleteSelected: () => void
  animate: boolean
  transition: SlotMotion
}

const WorkspaceSelectionContext = createContext<WorkspaceSelectionValue | null>(
  null
)

export function WorkspaceSelectionProvider({
  chats,
  children,
  onMoveChats,
  onRequestDeleteChats,
  animate,
  transition,
}: {
  chats: ChatRow[]
  children: ReactNode
  onMoveChats?: (chatIds: string[], spaceId: string | null) => void
  onRequestDeleteChats?: (chatIds: string[]) => void
  animate: boolean
  transition: SlotMotion
}) {
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const chatIdSet = useMemo(
    () => new Set(chats.map((chat) => chat.id)),
    [chats]
  )

  useEffect(() => {
    setSelected((current) => {
      let changed = false
      const next = new Set<string>()
      for (const id of current) {
        if (chatIdSet.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : current
    })
    setAnchor((current) =>
      current && !chatIdSet.has(current) ? null : current
    )
  }, [chatIdSet])

  const selectChat = useCallback(
    (chatId: string, keys: ChatSelectKeys, orderedIds: readonly string[]) => {
      setSelecting(true)
      setSelected((current) => {
        const next = applyChatSelection(
          current,
          chatId,
          keys,
          orderedIds,
          anchor
        )
        setAnchor(next.anchor)
        return next.selected
      })
    },
    [anchor]
  )

  const setSelectedIds = useCallback((chatIds: readonly string[]) => {
    setSelecting(true)
    setSelected(new Set(chatIds))
    setAnchor(chatIds.at(-1) ?? null)
  }, [])

  const enterSelecting = useCallback((chatIds?: readonly string[]) => {
    setSelecting(true)
    if (chatIds) {
      setSelected(new Set(chatIds))
      setAnchor(chatIds.at(-1) ?? null)
    }
  }, [])

  const clearSelection = useCallback(() => {
    setSelecting(false)
    setSelected(new Set())
    setAnchor(null)
  }, [])

  const moveSelected = useCallback(
    (spaceId: string | null) => {
      onMoveChats?.([...selectedRef.current], spaceId)
    },
    [onMoveChats]
  )

  const requestDeleteSelected = useCallback(() => {
    onRequestDeleteChats?.([...selectedRef.current])
  }, [onRequestDeleteChats])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      if (!selecting && selected.size === 0) return
      event.preventDefault()
      clearSelection()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [clearSelection, selected.size, selecting])

  const value = useMemo<WorkspaceSelectionValue>(
    () => ({
      selecting,
      selectedIds: selected,
      selectedCount: selected.size,
      isSelected: (chatId) => selected.has(chatId),
      selectChat,
      setSelectedIds,
      enterSelecting,
      clearSelection,
      moveSelected,
      requestDeleteSelected,
      animate,
      transition,
    }),
    [
      animate,
      clearSelection,
      enterSelecting,
      moveSelected,
      requestDeleteSelected,
      selectChat,
      selected,
      selecting,
      setSelectedIds,
      transition,
    ]
  )

  return (
    <WorkspaceSelectionContext.Provider value={value}>
      {children}
    </WorkspaceSelectionContext.Provider>
  )
}

export function useOptionalWorkspaceSelection() {
  return useContext(WorkspaceSelectionContext)
}

export function useWorkspaceSelection() {
  const value = useOptionalWorkspaceSelection()
  if (!value) {
    throw new Error(
      "useWorkspaceSelection must be used within WorkspaceSelectionProvider"
    )
  }
  return value
}

export function useChatPressSelect(chatId: string, enabled: boolean) {
  const selection = useOptionalWorkspaceSelection()
  const pressTimer = useRef<number | null>(null)
  const ignoreClick = useRef(false)
  const origin = useRef<{ x: number; y: number } | null>(null)

  function clearPress() {
    if (pressTimer.current == null) return
    window.clearTimeout(pressTimer.current)
    pressTimer.current = null
    origin.current = null
  }

  function beginSelect() {
    selection?.enterSelecting([chatId])
  }

  return {
    onPointerDown: (event: {
      pointerType: string
      button: number
      clientX: number
      clientY: number
    }) => {
      if (!enabled || !selection || selection.selecting) return
      if (event.pointerType === "mouse" && event.button !== 0) return
      clearPress()
      origin.current = { x: event.clientX, y: event.clientY }
      pressTimer.current = window.setTimeout(() => {
        pressTimer.current = null
        origin.current = null
        ignoreClick.current = true
        beginSelect()
      }, 400)
    },
    onPointerMove: (event: { clientX: number; clientY: number }) => {
      if (pressTimer.current == null || !origin.current) return
      const dx = event.clientX - origin.current.x
      const dy = event.clientY - origin.current.y
      if (Math.hypot(dx, dy) < 6) return
      clearPress()
    },
    onPointerUp: clearPress,
    onPointerCancel: clearPress,
    onContextMenu: (event: { preventDefault: () => void }) => {
      if (!enabled || !selection) return
      event.preventDefault()
      beginSelect()
    },
    consumeClick: () => {
      if (!ignoreClick.current) return false
      ignoreClick.current = false
      return true
    },
  }
}
