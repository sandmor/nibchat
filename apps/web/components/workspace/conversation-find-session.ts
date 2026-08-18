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
import { conversationFindTextFromParts } from "@/lib/agent/parts"
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

type SelectPathInput = { chatId: string; nodeId: string }
type FindTextEntry = { partsJson: string; findText: string }

function nextFindTextCache(
  previous: Map<string, FindTextEntry>,
  nodes: readonly NodeRow[]
) {
  const next = new Map<string, FindTextEntry>()
  let same = true
  for (const node of nodes) {
    if (node.status === "streaming") continue
    const cached = previous.get(node.id)
    const entry =
      cached && cached.partsJson === node.parts_json
        ? cached
        : {
            partsJson: node.parts_json,
            findText: conversationFindTextFromParts(
              parseJson<Parts>(node.parts_json, [])
            ),
          }
    if (entry !== cached) same = false
    next.set(node.id, entry)
  }
  if (same && next.size === previous.size) {
    for (const id of previous.keys()) {
      if (!next.has(id)) return next
    }
    return previous
  }
  return next
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
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const [findTextCache, setFindTextCache] = useState(
    () => new Map<string, FindTextEntry>()
  )
  const [boundIdentity, setBoundIdentity] = useState(chatIdentity)
  if (boundIdentity !== chatIdentity) {
    setBoundIdentity(chatIdentity)
    setFindOpen(false)
    setFindQuery("")
    setOccurrenceIndex(0)
    setPendingPath(null)
    setFindLocate(null)
    setLocatedKey(null)
    setFindTextCache(new Map())
  }
  if (findOpen) {
    const next = nextFindTextCache(findTextCache, nodes)
    if (next !== findTextCache) setFindTextCache(next)
  }

  const searchNodes = useMemo(() => {
    if (!findOpen) return []
    return [...findTextCache.entries()].map(([id, entry]) => ({
      id,
      findText: entry.findText,
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
  const searchHitIds = useMemo(
    () => new Set(allHits.map((hit) => hit.nodeId)),
    [allHits]
  )
  const activeFindCount = currentHit
    ? scopedHits.filter((hit) => hit.nodeId === currentHit.nodeId).length
    : 0
  const locateKey = findLocate?.key ?? 0
  const layerValue = useMemo((): ConversationFindLayerValue | null => {
    if (!findOpen || !needle) return null
    return {
      query: needle,
      activeNodeId: currentHit?.nodeId ?? null,
      activeIndexInNode: occurrenceIndexInNode(scopedHits, activeIndex),
      activeFindCount,
      locateKey,
    }
  }, [
    activeFindCount,
    activeIndex,
    currentHit?.nodeId,
    findOpen,
    locateKey,
    needle,
    scopedHits,
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
    setFindLocate((current) => ({
      nodeId,
      key: (current?.key ?? 0) + 1,
    }))
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
    requestAnimationFrame(() => restore?.focus())
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
          inPane: Boolean(element && paneRef.current?.contains(element)),
          inFindInput: Boolean(element?.closest("[data-find-input]")),
          inDialog: Boolean(
            element?.closest('[role="dialog"], [role="alertdialog"]')
          ),
        }
      )
      if (!action) return
      event.preventDefault()
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
