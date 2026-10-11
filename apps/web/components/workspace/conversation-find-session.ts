"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react"
import { useShallow } from "zustand/react/shallow"
import {
  adjacentTextPartGroups,
  conversationFindTextFromParts,
} from "@/lib/agent/parts"
import {
  buildHits,
  distinctOffPathMessageCount,
  distinctPathMessageCount,
  firstHitOnNode,
  firstOffPathHit,
  needsPathConfirm,
  normalizeQuery,
  occurrenceIndexInNode,
  occurrenceKey,
  pathHits,
  pinnedOccurrenceIndex,
  planPathSwitch,
  snippet,
  stepIndex,
} from "@/lib/conversation-search"
import { parseJson } from "@/lib/domain"
import type { NodeRow, Parts } from "@/lib/types"
import { layoutNodeIds } from "./tree-layout"
import { conversationFindKeyAction } from "./conversation-find-keys"
import type { ConversationFindLayerValue } from "./conversation-find"
import type { FindResultRow } from "./conversation-find-bar"

import {
  messageEditSlotId,
  useConversationSessionStore,
  type MessageEditorSession,
} from "./conversation-session-store"

type SelectPathInput = { chatId: string; nodeId: string }
type FindTextEntry = {
  partsJson: string
  session?: MessageEditorSession
  findText: string
  fields?: { key: string; start: number; end: number; editor: boolean }[]
}

function draftFindText(session: MessageEditorSession) {
  let findText = ""
  const fields: { key: string; start: number; end: number; editor: boolean }[] =
    []
  const append = (text: string, key: string, editor: boolean) => {
    if (!text) return
    if (findText) findText += "\n"
    const start = findText.length
    findText += text
    fields.push({ key, start, end: findText.length, editor })
  }
  adjacentTextPartGroups(session.parts).forEach(({ part, index }) =>
    append(
      conversationFindTextFromParts([part]),
      session.keys[index] ?? String(index),
      part.type === "text"
    )
  )
  return { findText, fields }
}

function nextFindTextCache(
  previous: Map<string, FindTextEntry>,
  nodes: readonly NodeRow[],
  sessions: Record<string, MessageEditorSession>
) {
  const next = new Map<string, FindTextEntry>()
  let same = true
  for (const node of nodes) {
    if (node.status === "streaming") continue
    const session = sessions[messageEditSlotId(node.chat_id, node.id)]
    const partsJson = node.parts_json
    const cached = previous.get(node.id)
    const entry =
      cached && cached.partsJson === partsJson && cached.session === session
        ? cached
        : {
            partsJson,
            session,
            ...(session
              ? draftFindText(session)
              : {
                  findText: conversationFindTextFromParts(
                    parseJson<Parts>(partsJson, [])
                  ),
                }),
          }
    if (entry !== cached) same = false
    next.set(node.id, entry)
  }
  if (same && next.size === previous.size) return previous
  return next
}

function createFindTextCache() {
  let previous = new Map<string, FindTextEntry>()
  return (
    nodes: readonly NodeRow[],
    sessions: Record<string, MessageEditorSession>
  ) => {
    previous = nextFindTextCache(previous, nodes, sessions)
    return previous
  }
}

const NO_FIND_SESSIONS: Record<string, MessageEditorSession> = {}

function useFindEditSessions(nodes: readonly NodeRow[], open: boolean) {
  const slots = useMemo(
    () => nodes.map((node) => messageEditSlotId(node.chat_id, node.id)),
    [nodes]
  )
  return useConversationSessionStore(
    useShallow((state) => {
      if (!open) return NO_FIND_SESSIONS
      const sessions: Record<string, MessageEditorSession> = {}
      for (const slot of slots) {
        const session = state.sessions[slot]
        if (session) sessions[slot] = session
      }
      return sessions
    })
  )
}

function useStableHitIds(hits: readonly { nodeId: string }[]) {
  const signature = JSON.stringify(
    [...new Set(hits.map((hit) => hit.nodeId))].sort()
  )
  return useMemo(() => new Set(JSON.parse(signature) as string[]), [signature])
}

export function useConversationFindSession({
  chatIdentity,
  view,
  setView,
  nodes,
  pathIds,
  pathChatId,
  renameOpen,
  paneRef,
  selectPath,
  selectPathPending,
  setScrollTargetId,
}: {
  chatIdentity: string
  view: "linear" | "tree"
  setView: Dispatch<SetStateAction<"linear" | "tree">>
  nodes: NodeRow[]
  pathIds: readonly string[]
  pathChatId: string | null
  renameOpen: boolean
  paneRef: RefObject<HTMLElement | null>
  selectPath: (
    input: SelectPathInput,
    options?: { onSuccess?: () => void }
  ) => void
  selectPathPending: boolean
  setScrollTargetId: (id: string | null) => void
}) {
  const [findOpen, setFindOpen] = useState(false)
  const sessions = useFindEditSessions(nodes, findOpen)
  const [findQuery, setFindQuery] = useState("")
  const [occurrenceIndex, setOccurrenceIndex] = useState(0)
  const [pendingPath, setPendingPath] = useState<{
    nodeId: string
    pin: string | null
  } | null>(null)
  const [findFocusNonce, setFindFocusNonce] = useState(0)
  const [findLocate, setFindLocate] = useState<{
    nodeId: string
    key: number
  } | null>(null)
  const [locatedKey, setLocatedKey] = useState<string | null>(null)
  const locateNonceRef = useRef(0)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  // Reading the chat id resets this cache when the open chat changes.
  const readFindText = useMemo(() => {
    void chatIdentity
    return createFindTextCache()
  }, [chatIdentity])
  const [boundIdentity, setBoundIdentity] = useState(chatIdentity)
  if (boundIdentity !== chatIdentity) {
    setBoundIdentity(chatIdentity)
    setFindOpen(false)
    setFindQuery("")
    setOccurrenceIndex(0)
    setPendingPath(null)
    setFindLocate(null)
    setLocatedKey(null)
  }
  const findTextCache = useMemo(
    () =>
      findOpen
        ? readFindText(nodes, sessions)
        : new Map<string, FindTextEntry>(),
    [readFindText, findOpen, nodes, sessions]
  )

  const searchNodes = useMemo(() => {
    if (!findOpen) return []
    return [...findTextCache.entries()].map(([id, entry]) => ({
      id,
      findText: entry.findText,
      fields: entry.fields,
    }))
  }, [findOpen, findTextCache])
  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes]
  )
  const findTextById = useMemo(
    () => new Map(searchNodes.map((node) => [node.id, node.findText])),
    [searchNodes]
  )
  const layoutIds = useMemo(
    () => (findOpen ? layoutNodeIds(nodes) : []),
    [findOpen, nodes]
  )
  const allHits = useMemo(
    () =>
      findOpen ? buildHits(searchNodes, findQuery, { pathIds, layoutIds }) : [],
    [findOpen, searchNodes, findQuery, pathIds, layoutIds]
  )
  const scopedHits = useMemo(
    () => (view === "linear" ? pathHits(allHits) : allHits),
    [allHits, view]
  )
  const activeIndex = pinnedOccurrenceIndex(
    scopedHits,
    locatedKey,
    occurrenceIndex
  )
  const offPathCount =
    view === "linear" ? distinctOffPathMessageCount(allHits) : 0
  const pathCount = view === "linear" ? distinctPathMessageCount(allHits) : 0
  const currentHit = scopedHits[activeIndex]
  const needle = normalizeQuery(findQuery)
  const searchHitIds = useStableHitIds(allHits)
  const activeFindCount = currentHit
    ? scopedHits.filter((hit) => hit.nodeId === currentHit.nodeId).length
    : 0
  const locateKey = findLocate?.key ?? 0
  const activeIndexInNode = occurrenceIndexInNode(scopedHits, activeIndex)
  const layerValue = useMemo((): ConversationFindLayerValue | null => {
    if (!findOpen || !needle) return null
    return {
      query: needle,
      activeNodeId: currentHit?.nodeId ?? null,
      activeIndexInNode,
      activeFindCount,
      locateKey,
      activeEditorKey: currentHit?.editorKey,
      activeEditorStart: currentHit?.editorStart,
      activeFieldKey: currentHit?.fieldKey,
      activeFieldIndex: currentHit?.fieldIndex,
      activeFieldCount: currentHit?.fieldCount,
    }
  }, [
    activeFindCount,
    activeIndexInNode,
    currentHit?.nodeId,
    currentHit?.editorKey,
    currentHit?.editorStart,
    currentHit?.fieldKey,
    currentHit?.fieldIndex,
    currentHit?.fieldCount,
    findOpen,
    locateKey,
    needle,
  ])
  const findResults = useMemo((): FindResultRow[] | null => {
    if (view !== "tree" || !findOpen || !needle) return null
    const seen = new Set<string>()
    const rows: FindResultRow[] = []
    for (const hit of allHits) {
      if (seen.has(hit.nodeId)) continue
      seen.add(hit.nodeId)
      const node = nodeById.get(hit.nodeId)
      rows.push({
        nodeId: hit.nodeId,
        role: node?.role ?? "assistant",
        onPath: hit.onPath,
        snippet: snippet(
          findTextById.get(hit.nodeId) ?? "",
          hit.start,
          findQuery
        ),
      })
    }
    return rows
  }, [allHits, findOpen, findQuery, findTextById, needle, nodeById, view])

  const bumpFindLocate = useCallback((nodeId: string) => {
    setFindLocate({
      nodeId,
      key: ++locateNonceRef.current,
    })
  }, [])

  const goToOccurrence = useCallback(
    (index: number) => {
      const hit = scopedHits[index]
      if (!hit) return
      setLocatedKey(occurrenceKey(hit))
      setOccurrenceIndex(index)
      bumpFindLocate(hit.nodeId)
      if (view === "linear") setScrollTargetId(hit.nodeId)
    },
    [bumpFindLocate, scopedHits, setScrollTargetId, view]
  )

  const stepFind = useCallback(
    (delta: number) => {
      if (!findOpen || scopedHits.length === 0) return
      const current = scopedHits[activeIndex]
      if (!current) return
      if (locatedKey !== occurrenceKey(current)) {
        goToOccurrence(activeIndex)
        return
      }
      goToOccurrence(stepIndex(activeIndex, delta, scopedHits.length))
    },
    [activeIndex, findOpen, goToOccurrence, locatedKey, scopedHits]
  )

  const openFind = useCallback(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement && paneRef.current?.contains(active)) {
      restoreFocusRef.current = active
    }
    setFindOpen(true)
    setFindFocusNonce((nonce) => nonce + 1)
  }, [paneRef])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    setFindLocate(null)
    const restore = restoreFocusRef.current
    restoreFocusRef.current = null
    requestAnimationFrame(() => {
      if (restore?.isConnected) restore.focus({ preventScroll: true })
    })
  }, [])

  const onQueryChange = useCallback((value: string) => {
    setFindQuery(value)
    setOccurrenceIndex(0)
    setLocatedKey(null)
    setFindLocate(null)
  }, [])

  const requestPathSwitch = useCallback(
    (nodeId: string) => {
      const plan = planPathSwitch(nodeId, allHits, pathIds)
      if (!plan.confirm) {
        if (plan.pin) {
          setLocatedKey(plan.pin)
          setOccurrenceIndex(plan.index)
        }
        bumpFindLocate(nodeId)
        setScrollTargetId(nodeId)
        return
      }
      setPendingPath({ nodeId: plan.nodeId, pin: plan.pin })
    },
    [allHits, bumpFindLocate, pathIds, setScrollTargetId]
  )

  const confirmPathSwitch = useCallback(() => {
    const pending = pendingPath
    if (!pending || !pathChatId || selectPathPending) return
    selectPath(
      { chatId: pathChatId, nodeId: pending.nodeId },
      {
        onSuccess: () => {
          setPendingPath(null)
          if (pending.pin) {
            setLocatedKey(pending.pin)
            setOccurrenceIndex(0)
          }
          bumpFindLocate(pending.nodeId)
          setScrollTargetId(pending.nodeId)
        },
      }
    )
  }, [
    bumpFindLocate,
    pathChatId,
    pendingPath,
    selectPath,
    selectPathPending,
    setScrollTargetId,
  ])

  const dismissPathSwitch = useCallback(() => {
    if (selectPathPending) return
    setPendingPath(null)
  }, [selectPathPending])

  const showOffPathInTree = useCallback(() => {
    const hit = firstOffPathHit(allHits)
    setView("tree")
    if (!hit) return
    const index = allHits.indexOf(hit)
    setOccurrenceIndex(index)
    setLocatedKey(occurrenceKey(hit))
    bumpFindLocate(hit.nodeId)
  }, [allHits, bumpFindLocate, setView])

  const jumpToFirstOffPath = useCallback(() => {
    const hit = firstOffPathHit(allHits)
    if (hit) requestPathSwitch(hit.nodeId)
  }, [allHits, requestPathSwitch])

  const locateNode = useCallback(
    (nodeId: string) => {
      const found = firstHitOnNode(scopedHits, nodeId)
      if (!found) {
        bumpFindLocate(nodeId)
        return
      }
      goToOccurrence(found.index)
    },
    [bumpFindLocate, goToOccurrence, scopedHits]
  )

  const useThisPath = useCallback(() => {
    if (currentHit) requestPathSwitch(currentHit.nodeId)
  }, [currentHit, requestPathSwitch])

  const canUseThisPath = Boolean(
    view === "tree" &&
    currentHit &&
    needsPathConfirm(currentHit.nodeId, pathIds)
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const element = event.target instanceof Element ? event.target : null
      const action = conversationFindKeyAction(
        {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
        },
        {
          findOpen,
          pendingPathSwitch: pendingPath !== null,
          renameOpen,
          view,
          canUseThisPath,
          inPane: Boolean(
            element &&
            (element === document.body || paneRef.current?.contains(element))
          ),
          inFindInput: Boolean(element?.closest("[data-find-input]")),
          inDialog: Boolean(
            element?.closest('[role="dialog"], [role="alertdialog"]')
          ),
        }
      )
      if (!action) return
      event.preventDefault()
      event.stopPropagation()
      if (action === "open") openFind()
      else if (action === "close") closeFind()
      else if (action === "next") stepFind(1)
      else if (action === "prev") stepFind(-1)
      else if (action === "use-path" && currentHit) {
        requestPathSwitch(currentHit.nodeId)
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [
    canUseThisPath,
    closeFind,
    currentHit,
    findOpen,
    openFind,
    paneRef,
    pendingPath,
    renameOpen,
    requestPathSwitch,
    stepFind,
    view,
  ])

  return {
    findOpen,
    findQuery,
    findNeedle: needle,
    onQueryChange,
    focusNonce: findFocusNonce,
    current: scopedHits.length === 0 ? 0 : activeIndex + 1,
    total: scopedHits.length,
    pathCount,
    offPathCount,
    showUseThisPath: canUseThisPath,
    pendingPathNodeId: pendingPath?.nodeId ?? null,
    pathSwitchPending: selectPathPending,
    confirmPathSwitch,
    dismissPathSwitch,
    findLocate,
    locateKey,
    searchHitIds,
    layerValue,
    results: findResults,
    activeNodeId: currentHit?.nodeId ?? null,
    closeFind,
    stepFind,
    locateNode,
    useThisPath,
    showOffPathInTree,
    jumpToFirstOffPath,
  }
}
