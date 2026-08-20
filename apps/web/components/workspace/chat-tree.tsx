"use client"

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  MapsGlobal01Icon,
  MinusSignIcon,
  Navigation03Icon,
  PlusSignIcon,
  StopIcon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"
import type { NodeRow } from "@/lib/types"
import type { ProviderSummary } from "./types"
import { ComposeSlot, TreeHandoff, TreePlaque } from "./tree-card"
import { Message } from "./message"
import { StreamingBubble } from "./streaming-bubble"
import { collectHandoffs, uniqueHandoffAnchors } from "./tree-handoff"
import {
  ROOT_ADD_ID,
  addAnchor,
  addId,
  cardMaxHeight,
  composeLayoutId,
  isAddId,
  layoutChatTree,
  treeConnectorPath,
  type TreeLayout,
  type TreeRect,
} from "./tree-layout"
import { minimapCardSketch, minimapEdges, minimapViewBox } from "./tree-minimap"
import {
  CENTER_SCALE,
  DEFAULT_CAMERA,
  PAN_THRESHOLD,
  applyCameraTransform,
  applyMinimapView,
  applyZoomCssVars,
  cameraEqual,
  centerOnRect,
  consumeTreeWheel,
  createTreeViewStore,
  nodePaint,
  panBy,
  pointerOnFocusedSelectable,
  rectFullyVisible,
  scaleToReadCard,
  treeViewSnapshot,
  viewNeedsRecull,
  wheelTargetScrolls,
  worldViewRect,
  zoomToward,
  type Camera,
} from "./tree-camera"

const CHROME_SELECTOR =
  "button,a,input,textarea,select,[role=dialog],[data-tree-chrome]"

const EMPTY_HIT_IDS: ReadonlySet<string> = new Set()
const EMPTY_VISIBLE: ReadonlySet<string> = new Set()
const EMPTY_EDITING_IDS: ReadonlySet<string> = new Set()

function readTreeCardSizes(
  current: ReadonlyMap<string, number>,
  elements: Iterable<Element>
) {
  let changed = false
  const next = new Map(current)
  for (const node of elements) {
    const el = node as HTMLElement
    const id = el.dataset.treeSize
    if (!id) continue
    const height = Math.round(el.offsetHeight)
    if (next.get(id) !== height) {
      next.set(id, height)
      changed = true
    }
  }
  return changed ? next : current
}

export function ChatTree({
  nodes,
  activePath,
  draftAnchors,
  editingNodeIds = EMPTY_EDITING_IDS,
  providers,
  streamIdByNodeId,
  animate,
  transition,
  messageActionCaptions,
  renderComposer,
  onOpenDraft,
  onSendDraft,
  messageLayoutIds = {},
  focusTargetId,
  onFocusTargetConsumed,
  onHandoffComplete,
  findQuery = "",
  searchHitIds,
  findLocate = null,
  onLocateHit,
  onChanged,
  onRegenerate,
  onGenerateUnder,
  onAnswerTools,
  onStop,
}: {
  nodes: NodeRow[]
  activePath: NodeRow[]
  draftAnchors: ReadonlySet<string | null>
  editingNodeIds?: ReadonlySet<string>
  providers: ProviderSummary[]
  streamIdByNodeId: ReadonlyMap<string, string>
  animate: boolean
  transition: { duration: number; ease: [number, number, number, number] }
  messageActionCaptions: boolean
  renderComposer: (
    anchor: string | null,
    options: {
      autoFocus: boolean
      submitting: boolean
      onSend: () => void
    }
  ) => ReactNode
  onOpenDraft: (anchor: string | null) => void
  onSendDraft: (anchor: string | null) => Promise<boolean>
  messageLayoutIds?: Readonly<Record<string, string>>
  focusTargetId?: string | null
  onFocusTargetConsumed?: () => void
  findQuery?: string
  searchHitIds?: ReadonlySet<string>
  findLocate?: { nodeId: string; key: number } | null
  onLocateHit?: (nodeId: string) => void
  onHandoffComplete?: (anchor: string | null) => void
  onChanged: () => void | Promise<void>
  onRegenerate: (id: string) => void
  onGenerateUnder: (id: string) => void
  onAnswerTools: (
    id: string,
    results: Array<{ toolCallId: string; output: unknown }>
  ) => void
  onStop: () => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    pointerId: number
    x: number
    y: number
    mode: "pending" | "pan"
  } | null>(null)
  const cameraRef = useRef<Camera>(DEFAULT_CAMERA)
  const viewStoreRef = useRef<ReturnType<typeof createTreeViewStore> | null>(
    null
  )
  if (viewStoreRef.current === null) {
    viewStoreRef.current = createTreeViewStore({
      sig: "",
      ids: EMPTY_VISIBLE,
      scale: DEFAULT_CAMERA.scale,
      tier: "work",
      paintSig: "",
    })
  }
  const viewStore = viewStoreRef.current
  const view = useSyncExternalStore(
    viewStore.subscribe,
    viewStore.getSnapshot,
    viewStore.getSnapshot
  )
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const viewportSizeRef = useRef(viewportSize)
  const minimapViewsRef = useRef<
    ArrayLike<{ setAttribute: (name: string, value: string) => void }>
  >([])
  const viewRafRef = useRef(0)
  const lastCullViewRef = useRef<TreeRect | null>(null)
  const lastCullScaleRef = useRef(DEFAULT_CAMERA.scale)
  const zoomCssScaleRef = useRef(Number.NaN)
  const [sizes, setSizes] = useState<ReadonlyMap<string, number>>(
    () => new Map()
  )
  const [forestMotion, setForestMotion] = useState(false)
  const didCenter = useRef(false)
  const zoomTierRef = useRef(view.tier)
  const focusedIdRef = useRef(focusedId)
  const findLocateAppliedKeyRef = useRef(0)
  const draftHeightsRef = useRef(new Map<string, number>())
  const editHeightsRef = useRef(new Map<string, number>())
  const [composeSources, setComposeSources] = useState<
    ReadonlyMap<string, TreeRect>
  >(() => new Map())
  const [submittingLayouts, setSubmittingLayouts] = useState<
    ReadonlySet<string>
  >(() => new Set())
  const submittingLayoutsRef = useRef(new Set<string>())
  const morphsRef = useRef(messageLayoutIds)
  morphsRef.current = messageLayoutIds
  const onHandoffCompleteRef = useRef(onHandoffComplete)
  onHandoffCompleteRef.current = onHandoffComplete
  const layout = useMemo(
    () => layoutChatTree(nodes, { draftAnchors, editingNodeIds, sizes }),
    [nodes, draftAnchors, editingNodeIds, sizes]
  )
  const forestTransition =
    animate && forestMotion ? transition : { ...transition, duration: 0 }
  const layoutRef = useRef(layout)
  const moveCameraRef = useRef<(next: Camera, immediate?: boolean) => void>(
    () => {}
  )
  const pathIds = useMemo(
    () => new Set(activePath.map((node) => node.id)),
    [activePath]
  )
  const searching = findQuery.trim().length > 0
  const hitIds = searchHitIds ?? EMPTY_HIT_IDS
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes]
  )
  const handoffs = useMemo(
    () =>
      collectHandoffs(
        messageLayoutIds,
        new Set(nodesById.keys()),
        composeSources,
        layout.rects
      ),
    [messageLayoutIds, nodesById, composeSources, layout]
  )
  const handoffByAnchor = useMemo(
    () => new Map(handoffs.map((item) => [item.anchor, item] as const)),
    [handoffs]
  )
  const handoffNodeIds = useMemo(
    () => new Set(handoffs.map((item) => item.userNodeId)),
    [handoffs]
  )
  const litIds = useMemo(() => {
    const lit = new Set(pathIds)
    let id: string | null = focusedId
    while (id) {
      lit.add(id)
      id = nodesById.get(id)?.parent_id ?? null
    }
    return lit
  }, [pathIds, focusedId, nodesById])

  useEffect(() => {
    focusedIdRef.current = focusedId
  }, [focusedId])

  const releaseCompose = (layoutId: string) => {
    submittingLayoutsRef.current.delete(layoutId)
    setComposeSources((current) => {
      const next = new Map(current)
      next.delete(layoutId)
      return next
    })
    setSubmittingLayouts((current) => {
      const next = new Set(current)
      next.delete(layoutId)
      return next
    })
  }

  const beginSend = (anchor: string | null, rect: TreeRect) => {
    const layoutId = composeLayoutId(anchor)
    if (submittingLayoutsRef.current.has(layoutId)) return
    submittingLayoutsRef.current.add(layoutId)
    setComposeSources((current) => {
      const next = new Map(current)
      next.set(layoutId, { ...rect })
      return next
    })
    setSubmittingLayouts((current) => new Set(current).add(layoutId))
    void onSendDraft(anchor)
      .then((started) => {
        if (!started) releaseCompose(layoutId)
      })
      .catch(() => releaseCompose(layoutId))
  }

  const finishHandoff = (anchor: string | null) => {
    const layoutId = composeLayoutId(anchor)
    releaseCompose(layoutId)
    onHandoffComplete?.(anchor)
  }

  // Finish morphs on real unmount (Linear toggle). Refs keep the latest pair.
  useEffect(() => {
    return () => {
      for (const anchor of uniqueHandoffAnchors(morphsRef.current))
        onHandoffCompleteRef.current?.(anchor)
    }
  }, [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const update = () => {
      const next = {
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      }
      viewportSizeRef.current = next
      setViewportSize(next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const viewportMetrics = () => viewportSizeRef.current

  const viewportPoint = (clientX: number, clientY: number) => {
    const box = viewportRef.current?.getBoundingClientRect()
    if (!box) return { x: 0, y: 0 }
    return { x: clientX - box.left, y: clientY - box.top }
  }

  const paintCamera = (next: Camera, smooth?: boolean) => {
    cameraRef.current = next
    const world = worldRef.current
    if (world) {
      if (smooth === true) world.dataset.smooth = ""
      else if (smooth === false) delete world.dataset.smooth
      applyCameraTransform(world, next)
      if (zoomCssScaleRef.current !== next.scale) {
        zoomCssScaleRef.current = next.scale
        applyZoomCssVars(world, next.scale)
      }
    }
    applyMinimapView(minimapViewsRef.current, next, viewportMetrics())
  }

  const commitView = (force = false) => {
    const viewport = viewportMetrics()
    if (viewport.width <= 0 || viewport.height <= 0) return
    const camera = cameraRef.current
    const view = worldViewRect(camera, viewport)
    const scaleChanged = camera.scale !== lastCullScaleRef.current
    if (!force && !viewNeedsRecull(lastCullViewRef.current, view, scaleChanged))
      return
    const next = treeViewSnapshot(
      layoutRef.current.rects,
      camera,
      viewport,
      zoomTierRef.current,
      viewStore.getSnapshot()
    )
    zoomTierRef.current = next.tier
    lastCullViewRef.current = view
    lastCullScaleRef.current = camera.scale
    viewStore.commit(next)
  }

  const scheduleView = () => {
    if (viewRafRef.current) return
    viewRafRef.current = requestAnimationFrame(() => {
      viewRafRef.current = 0
      commitView()
    })
  }

  const moveCamera = (next: Camera, immediate = false) => {
    if (cameraEqual(cameraRef.current, next)) return
    paintCamera(next, Boolean(animate && !immediate))
    scheduleView()
  }

  useLayoutEffect(() => {
    layoutRef.current = layout
    moveCameraRef.current = moveCamera
    const viewport = viewportRef.current
    minimapViewsRef.current = viewport
      ? viewport.querySelectorAll("[data-tree-minimap-view]")
      : []
  })

  useLayoutEffect(() => {
    paintCamera(cameraRef.current)
    commitView(true)
    // Re-apply the current camera without toggling data-smooth, so layout
    // measurement and minimap overlay mounts cannot cancel an in-flight ease.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, viewportSize, mapOpen])

  useEffect(() => {
    return () => {
      if (!viewRafRef.current) return
      cancelAnimationFrame(viewRafRef.current)
      viewRafRef.current = 0
    }
  }, [])

  const centerOn = useCallback(
    (id: string, scale?: number, immediate = false) => {
      const rect = layout.rects.get(id)
      const viewport = viewportRef.current
      if (!rect || !viewport) return
      const viewportSizeNow = {
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      }
      const current = cameraRef.current
      const next = centerOnRect(
        current,
        rect,
        viewportSizeNow,
        scale ?? Math.max(current.scale, CENTER_SCALE)
      )
      moveCameraRef.current(next, immediate)
    },
    [layout]
  )

  const centerOnLive = useCallback(
    (id: string, immediate = false) => {
      const rect = layout.rects.get(id)
      if (!rect) return
      const camera = cameraRef.current
      centerOn(
        id,
        scaleToReadCard(rect, camera, zoomTierRef.current),
        immediate
      )
    },
    [layout, centerOn]
  )

  const frameRectIfNeeded = useCallback(
    (id: string, immediate = false) => {
      const rect = layout.rects.get(id)
      const viewport = viewportRef.current
      if (!rect || !viewport) return
      const viewportSizeNow = {
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      }
      if (rectFullyVisible(rect, cameraRef.current, viewportSizeNow)) return
      centerOn(id, undefined, immediate)
    },
    [layout, centerOn]
  )

  useLayoutEffect(() => {
    if (didCenter.current) return
    if (findLocate) return
    const tip = activePath.at(-1)?.id
    if (!tip || !layout.rects.has(tip) || !viewportRef.current) return
    didCenter.current = true
    setFocusedId(tip)
    centerOn(tip, undefined, true)
    // One-shot camera: tree focus is independent from later linear selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, activePath, findLocate])

  useLayoutEffect(() => {
    if (
      !focusTargetId ||
      !layout.rects.has(focusTargetId) ||
      !viewportRef.current
    )
      return
    didCenter.current = true
    setFocusedId(focusTargetId)
    centerOn(focusTargetId)
    onFocusTargetConsumed?.()
  }, [focusTargetId, layout, centerOn, onFocusTargetConsumed])

  useLayoutEffect(() => {
    if (!findLocate) {
      findLocateAppliedKeyRef.current = 0
      return
    }
    if (findLocateAppliedKeyRef.current === findLocate.key) return
    if (!layout.rects.has(findLocate.nodeId) || !viewportRef.current) return
    findLocateAppliedKeyRef.current = findLocate.key
    didCenter.current = true
    const id = findLocate.nodeId
    const rect = layout.rects.get(id)
    if (!rect) return
    const viewport = viewportRef.current
    const viewportSizeNow = {
      width: viewport.clientWidth,
      height: viewport.clientHeight,
    }
    const paint = nodePaint({
      rect,
      scale: cameraRef.current.scale,
      tier: zoomTierRef.current,
      interactive: false,
    })
    const alreadyOnCard =
      focusedIdRef.current === id &&
      paint === "live" &&
      rectFullyVisible(rect, cameraRef.current, viewportSizeNow)
    setFocusedId(id)
    if (!alreadyOnCard) centerOnLive(id)
  }, [findLocate, layout, centerOnLive])

  useLayoutEffect(() => {
    const world = worldRef.current
    if (!world) return
    const observer = new ResizeObserver((entries) => {
      setSizes((current) =>
        readTreeCardSizes(
          current,
          entries.map((entry) => entry.target)
        )
      )
    })
    const watch = () => {
      for (const el of world.querySelectorAll("[data-tree-size]"))
        observer.observe(el)
    }
    watch()
    const mutations = new MutationObserver(watch)
    mutations.observe(world, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      mutations.disconnect()
    }
  }, [])

  // Layout reserves cardMaxHeight until paint can be measured. Reading
  // offsetHeight here (before first paint) collapses that, and forestMotion
  // stays off for that commit so Motion does not tween the correction.
  useLayoutEffect(() => {
    const world = worldRef.current
    if (!world) return
    setSizes((current) =>
      readTreeCardSizes(current, world.querySelectorAll("[data-tree-size]"))
    )
  }, [nodes, view.sig, editingNodeIds])

  useLayoutEffect(() => {
    if (forestMotion) return
    if (sizes.size > 0) {
      setForestMotion(true)
      return
    }
    if (nodes.length > 0 && view.ids.size === 0) return
    const world = worldRef.current
    if (world?.querySelector("[data-tree-size]")) return
    setForestMotion(true)
  }, [forestMotion, sizes, nodes.length, view.ids])

  useLayoutEffect(() => {
    if (!didCenter.current) return
    for (const anchor of draftAnchors) {
      const id = anchor === null ? ROOT_ADD_ID : addId(anchor)
      const height = layout.rects.get(id)?.height ?? 0
      const previous = draftHeightsRef.current.get(id) ?? 0
      if (height > previous + 8) frameRectIfNeeded(id)
      draftHeightsRef.current.set(id, height)
    }
  }, [draftAnchors, layout, frameRectIfNeeded])

  useLayoutEffect(() => {
    if (!didCenter.current) return
    for (const id of editingNodeIds) {
      const height = layout.rects.get(id)?.height ?? 0
      const previous = editHeightsRef.current.get(id) ?? 0
      if (height > previous + 8) frameRectIfNeeded(id)
      editHeightsRef.current.set(id, height)
    }
  }, [editingNodeIds, layout, frameRectIfNeeded])

  const focusNode = (id: string) => {
    setFocusedId(id)
    const rect = layout.rects.get(id)
    if (!rect) return
    const camera = cameraRef.current
    const scale = scaleToReadCard(rect, camera, zoomTierRef.current)
    if (scale !== camera.scale) {
      centerOn(id, scale)
      return
    }
    frameRectIfNeeded(id)
  }

  const jumpToNode = (id: string) => {
    if (searching && hitIds.has(id) && onLocateHit) {
      onLocateHit(id)
      return
    }
    focusNode(id)
  }

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
      if (consumeTreeWheel(event)) return
      event.preventDefault()
      const current = cameraRef.current
      const next =
        event.ctrlKey || event.metaKey
          ? zoomToward(
              current,
              event.deltaY > 0 ? 0.9 : 1.1,
              viewportPoint(event.clientX, event.clientY)
            )
          : panBy(current, -event.deltaX, -event.deltaY)
      moveCameraRef.current(next, true)
    }
    viewport.addEventListener("wheel", onWheel, { passive: false })
    return () => viewport.removeEventListener("wheel", onWheel)
  }, [])

  const inView = (id: string) => view.ids.has(id)

  return (
    <div
      ref={viewportRef}
      data-testid="chat-tree"
      data-tree-motion
      data-theme-group="tree"
      data-theme-target="tree-chrome"
      style={
        {
          "--tree-motion-duration": animate ? `${transition.duration}s` : "0s",
          "--tree-motion-ease": `cubic-bezier(${transition.ease.join(",")})`,
        } as CSSProperties
      }
      className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden bg-[radial-gradient(circle_at_1px_1px,var(--tree-grid-color)_1px,transparent_0)] bg-size-[20px_20px] select-none data-[panning]:cursor-grabbing"
      role="region"
      aria-label="Conversation tree"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        const target = event.target
        if (target instanceof Element && target.closest(CHROME_SELECTOR)) return
        if (pointerOnFocusedSelectable(target, focusedId)) return
        drag.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          mode: "pending",
        }
      }}
      onPointerMove={(event) => {
        const state = drag.current
        if (!state || state.pointerId !== event.pointerId) return
        const dx = event.clientX - state.x
        const dy = event.clientY - state.y
        if (state.mode === "pending") {
          if (Math.hypot(dx, dy) < PAN_THRESHOLD) return
          if (wheelTargetScrolls(event.target, dx, dy)) {
            drag.current = null
            return
          }
          drag.current = {
            ...state,
            mode: "pan",
            x: event.clientX,
            y: event.clientY,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
          event.currentTarget.dataset.panning = ""
          window.getSelection()?.removeAllRanges()
          moveCamera(panBy(cameraRef.current, dx, dy), true)
          return
        }
        drag.current = { ...state, x: event.clientX, y: event.clientY }
        moveCamera(panBy(cameraRef.current, dx, dy), true)
      }}
      onPointerUp={(event) => {
        const state = drag.current
        drag.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId)
        delete event.currentTarget.dataset.panning
        if (!state || state.mode !== "pending") return
        const target = event.target
        if (!(target instanceof Element)) return
        const hit = target.closest("[data-tree-hit]")
        const hitId = hit?.getAttribute("data-tree-hit")
        if (!hitId || isAddId(hitId)) return
        if (searching && hitIds.has(hitId) && onLocateHit) {
          onLocateHit(hitId)
          return
        }
        focusNode(hitId)
      }}
      onPointerCancel={(event) => {
        drag.current = null
        delete event.currentTarget.dataset.panning
      }}
    >
      <div
        ref={worldRef}
        data-tree-world
        className="absolute origin-top-left will-change-transform"
        style={{
          width: layout.bounds.width,
          height: layout.bounds.height,
        }}
        onTransitionEnd={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.propertyName === "transform")
            delete event.currentTarget.dataset.smooth
        }}
      >
        <svg
          data-tree-edges
          className="pointer-events-none absolute inset-0 overflow-visible"
          width={layout.bounds.width}
          height={layout.bounds.height}
          aria-hidden
        >
          {layout.edges.map((edge) => {
            const from = layout.rects.get(edge.from)
            const to = layout.rects.get(edge.to)
            if (!from || !to) return null
            const d = treeConnectorPath(from, to)
            const lit = litIds.has(edge.from) && litIds.has(edge.to)
            const className = lit
              ? "stroke-[var(--tree-active-color)]"
              : "stroke-[var(--tree-edge-color)]"
            return animate ? (
              <motion.path
                key={`${edge.from}:${edge.to}`}
                initial={false}
                animate={{ d }}
                transition={forestTransition}
                fill="none"
                data-tree-edge-lit={lit ? "" : undefined}
                className={className}
              />
            ) : (
              <path
                key={`${edge.from}:${edge.to}`}
                d={d}
                fill="none"
                data-tree-edge-lit={lit ? "" : undefined}
                className={className}
              />
            )
          })}
        </svg>
        {nodes.map((node) => {
          if (handoffNodeIds.has(node.id)) return null
          const rect = layout.rects.get(node.id)
          if (!rect) return null
          const streamId = streamIdByNodeId.get(node.id)
          const focused = focusedId === node.id
          const liveWork =
            Boolean(streamId) ||
            node.status === "awaiting_input" ||
            node.status === "streaming" ||
            editingNodeIds.has(node.id)
          if (!liveWork && !focused && !inView(node.id)) return null
          const isHit = hitIds.has(node.id)
          const onPath = pathIds.has(node.id)
          const paint = nodePaint({
            rect,
            scale: view.scale,
            tier: view.tier,
            interactive: liveWork,
          })
          const maxHeight = editingNodeIds.has(node.id)
            ? undefined
            : cardMaxHeight(node)
          const live = paint === "live"
          return (
            <motion.div
              key={node.id}
              data-tree-hit={node.id}
              data-tree-size={live ? node.id : undefined}
              data-tree-live={live ? "" : undefined}
              className={cn(
                "absolute flex min-h-0 flex-col overflow-hidden rounded-xl",
                live
                  ? cn(
                      "[touch-action:pan-x_pan-y] shadow-[var(--tree-shadow-sm)]",
                      focused ? "cursor-auto select-text" : "select-none"
                    )
                  : "cursor-pointer",
                focused &&
                  "z-10 shadow-[var(--tree-shadow-lg)] ring-2 ring-[var(--tree-focus-color)]",
                searching &&
                  isHit &&
                  !focused &&
                  "z-10 ring-2 ring-[var(--tree-find-color)]",
                searching && !isHit && "opacity-50",
                !searching && !onPath && !focused && "opacity-55",
                // Find hits already use ring-*; a path ring here would win in
                // tailwind-merge and hide the highlight.
                onPath &&
                  !focused &&
                  !(searching && isHit) &&
                  "ring-1 ring-[var(--tree-path-color)]"
              )}
              initial={false}
              animate={{
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: live ? "auto" : rect.height,
              }}
              style={{ maxHeight }}
              transition={forestTransition}
            >
              {searching && isHit && !onPath ? (
                <span
                  data-find-skip
                  className="pointer-events-none absolute top-1.5 right-1.5 z-20 rounded-full bg-secondary px-1.5 py-px text-[10px] font-medium tracking-wide text-secondary-foreground uppercase"
                >
                  Off path
                </span>
              ) : null}
              {streamId && live ? (
                <StreamingBubble
                  streamId={streamId}
                  animate={animate}
                  transition={forestTransition}
                  presentation="tree"
                />
              ) : paint === "stub" ? (
                <div
                  className={cn(
                    "h-full w-full rounded-xl border",
                    node.role === "user"
                      ? "border-message-user-border bg-message-user"
                      : "border-message-assistant-border bg-message-assistant",
                    onPath && "border-[var(--tree-path-color)]"
                  )}
                />
              ) : paint === "map" ? (
                <TreePlaque node={node} onPath={onPath} />
              ) : (
                <TreeMessage
                  node={node}
                  nodes={nodes}
                  providers={providers}
                  messageActionCaptions={messageActionCaptions}
                  onChanged={onChanged}
                  onRegenerate={onRegenerate}
                  onGenerateUnder={onGenerateUnder}
                  onAnswerTools={onAnswerTools}
                />
              )}
            </motion.div>
          )
        })}
        {[...layout.rects.entries()]
          .filter(([id]) => isAddId(id))
          .map(([id, rect]) => {
            const anchor = addAnchor(id)
            if (handoffByAnchor.has(anchor)) return null
            const node = anchor ? nodesById.get(anchor) : undefined
            const disabled =
              node?.status === "streaming" || node?.status === "awaiting_input"
            const open = draftAnchors.has(anchor)
            const layoutId = composeLayoutId(anchor)
            const submitting = submittingLayouts.has(layoutId)
            if (!open && !inView(id)) return null
            return (
              <ComposeSlot
                key={id}
                id={id}
                open={open}
                rect={rect}
                animate={animate}
                transition={forestTransition}
                plusDisabled={disabled}
                plusLabel={anchor ? "Add branch" : "Add root branch"}
                onPlus={() => onOpenDraft(anchor)}
                composer={
                  open
                    ? renderComposer(anchor, {
                        autoFocus: true,
                        submitting,
                        onSend: () => beginSend(anchor, rect),
                      })
                    : null
                }
              />
            )
          })}
        {handoffs.map((handoff) => {
          const toRect = layout.rects.get(handoff.userNodeId)
          const node = nodesById.get(handoff.userNodeId)
          if (!toRect || !node) return null
          return (
            <TreeHandoff
              key={`handoff:${handoff.userNodeId}`}
              fromRect={handoff.fromRect}
              toRect={toRect}
              animate={animate}
              transition={transition}
              hitId={handoff.userNodeId}
              composer={renderComposer(handoff.anchor, {
                autoFocus: false,
                submitting: true,
                onSend: () => {},
              })}
              message={
                <TreeMessage
                  node={node}
                  nodes={nodes}
                  providers={providers}
                  messageActionCaptions={messageActionCaptions}
                  onChanged={onChanged}
                  onRegenerate={onRegenerate}
                  onGenerateUnder={onGenerateUnder}
                  onAnswerTools={onAnswerTools}
                />
              }
              onComplete={() => finishHandoff(handoff.anchor)}
            />
          )
        })}
      </div>
      <div
        data-tree-chrome
        className="absolute right-3 bottom-3 z-20 flex gap-1 rounded-xl border bg-[var(--tree-chrome-background)] p-1 shadow-[var(--tree-shadow-sm)] backdrop-blur"
      >
        {streamIdByNodeId.size ? (
          <Button
            size="icon-xs"
            variant="destructive"
            aria-label="Stop generation"
            onClick={onStop}
          >
            <HugeiconsIcon icon={StopIcon} className="size-3.5" />
          </Button>
        ) : null}
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Zoom in"
          onClick={() => {
            const viewport = viewportRef.current
            if (!viewport) return
            const point = {
              x: viewport.clientWidth / 2,
              y: viewport.clientHeight / 2,
            }
            moveCamera(zoomToward(cameraRef.current, 1.15, point), true)
          }}
        >
          <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Zoom out"
          onClick={() => {
            const viewport = viewportRef.current
            if (!viewport) return
            const point = {
              x: viewport.clientWidth / 2,
              y: viewport.clientHeight / 2,
            }
            moveCamera(zoomToward(cameraRef.current, 1 / 1.15, point), true)
          }}
        >
          <HugeiconsIcon icon={MinusSignIcon} className="size-3.5" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Focus current branch"
          onClick={() => {
            const tip = activePath.at(-1)?.id
            if (tip) focusNode(tip)
          }}
        >
          <HugeiconsIcon icon={Navigation03Icon} className="size-3.5" />
        </Button>
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon-xs"
        className="absolute top-3 right-3 z-20 sm:hidden"
        aria-label="Open conversation minimap"
        data-tree-chrome
        onClick={() => setMapOpen(true)}
      >
        <HugeiconsIcon icon={MapsGlobal01Icon} className="size-3.5" />
      </Button>
      <TreeMinimap
        layout={layout}
        nodesById={nodesById}
        viewportSize={viewportSize}
        focusedId={focusedId}
        pathIds={pathIds}
        searchHitIds={searching ? hitIds : undefined}
        onJump={jumpToNode}
        className="absolute top-3 right-3 z-20 hidden w-44 rounded-xl border bg-[var(--tree-chrome-background)] p-2 shadow-[var(--tree-shadow-sm)] backdrop-blur sm:block"
      />
      {mapOpen ? (
        <div
          data-tree-chrome
          className="absolute inset-0 z-30 grid place-items-center bg-[var(--tree-overlay-background)] p-6 backdrop-blur-sm sm:hidden"
          onClick={() => setMapOpen(false)}
        >
          <TreeMinimap
            layout={layout}
            nodesById={nodesById}
            viewportSize={viewportSize}
            focusedId={focusedId}
            pathIds={pathIds}
            searchHitIds={searching ? hitIds : undefined}
            onJump={(id) => {
              jumpToNode(id)
              setMapOpen(false)
            }}
            className="w-full max-w-sm rounded-2xl border bg-background p-3 shadow-[var(--tree-shadow-xl)]"
          />
        </div>
      ) : null}
    </div>
  )
}

function TreeMinimap({
  layout,
  nodesById,
  viewportSize,
  focusedId,
  pathIds,
  searchHitIds,
  onJump,
  className,
}: {
  layout: TreeLayout
  nodesById: ReadonlyMap<string, NodeRow>
  viewportSize: { width: number; height: number }
  focusedId: string | null
  pathIds: Set<string>
  searchHitIds?: ReadonlySet<string>
  onJump: (id: string) => void
  className: string
}) {
  const box = minimapViewBox(layout)
  const width = Math.max(1, box.width)
  const height = Math.max(1, box.height)
  return (
    <div data-tree-chrome className={className}>
      <svg
        viewBox={`${box.x} ${box.y} ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-28 w-full overflow-hidden rounded-md bg-[var(--tree-minimap-background)]"
        data-theme-target="tree-minimap-background"
        role="img"
        aria-label="Conversation minimap"
      >
        {minimapEdges(layout).map((edge) => {
          const a = layout.rects.get(edge.from)
          const b = layout.rects.get(edge.to)
          return a && b ? (
            <path
              key={`${edge.from}:${edge.to}`}
              d={treeConnectorPath(a, b)}
              fill="none"
              className="stroke-[var(--tree-minimap-edge)]"
              data-theme-target="tree-minimap-edge"
              vectorEffect="non-scaling-stroke"
              strokeWidth={1.25}
              strokeLinecap="round"
            />
          ) : null
        })}
        {[...layout.rects.entries()]
          .filter(([id]) => !isAddId(id))
          .map(([id, rect]) => {
            const node = nodesById.get(id)
            if (!node) return null
            const isHit = searchHitIds?.has(id)
            const onPath = pathIds.has(id)
            const focused = focusedId === id
            const sketch = minimapCardSketch(node, rect)
            const target = focused
              ? "tree-minimap-focus"
              : isHit
                ? "tree-minimap-find"
                : onPath
                  ? "tree-minimap-path"
                  : sketch.user
                    ? "tree-minimap-user"
                    : "tree-minimap-node"
            const label = node.search_text.trim()
            return (
              <g
                key={id}
                className="cursor-pointer"
                opacity={onPath || focused || isHit ? 1 : 0.55}
                onClick={() => onJump(id)}
              >
                {label ? <title>{label}</title> : null}
                <rect
                  x={rect.x}
                  y={rect.y}
                  width={rect.width}
                  height={rect.height}
                  rx={10}
                  data-theme-target={target}
                  className={cn(
                    sketch.user
                      ? "fill-[var(--tree-minimap-user)]"
                      : "fill-[var(--tree-minimap-node)]",
                    "stroke-[var(--tree-minimap-edge)]",
                    onPath && "stroke-[var(--tree-minimap-path)]",
                    isHit &&
                      !focused &&
                      "stroke-[var(--tree-minimap-find-stroke)]",
                    focused && "stroke-[var(--tree-minimap-focus)]"
                  )}
                  vectorEffect="non-scaling-stroke"
                  strokeWidth={focused || isHit ? 1.75 : onPath ? 1.5 : 1.15}
                />
                <rect
                  x={sketch.rail.x}
                  y={sketch.rail.y}
                  width={sketch.rail.width}
                  height={sketch.rail.height}
                  rx={sketch.rail.width / 2}
                  data-theme-target={
                    sketch.error
                      ? undefined
                      : sketch.user
                        ? "tree-minimap-user-rail"
                        : "tree-minimap-glyph"
                  }
                  className={
                    sketch.error
                      ? "fill-[var(--danger)]"
                      : sketch.user
                        ? "fill-[var(--tree-minimap-user-rail)]"
                        : "fill-[var(--tree-minimap-glyph)]"
                  }
                  pointerEvents="none"
                />
                {sketch.glyphs.map((glyph, index) => (
                  <rect
                    key={index}
                    x={glyph.x}
                    y={glyph.y}
                    width={glyph.width}
                    height={glyph.height}
                    rx={glyph.height / 2}
                    data-theme-target="tree-minimap-glyph"
                    className="fill-[var(--tree-minimap-glyph)]"
                    pointerEvents="none"
                  />
                ))}
              </g>
            )
          })}
        {viewportSize.width > 0 ? (
          <rect
            data-tree-minimap-view
            x={0}
            y={0}
            width={0}
            height={0}
            fill="none"
            data-theme-target="tree-viewport"
            className="stroke-[var(--tree-viewport-color)]"
            vectorEffect="non-scaling-stroke"
            strokeWidth={1.5}
            pointerEvents="none"
          />
        ) : null}
      </svg>
    </div>
  )
}

const TreeMessage = memo(function TreeMessage({
  node,
  nodes,
  providers,
  messageActionCaptions,
  onChanged,
  onRegenerate,
  onGenerateUnder,
  onAnswerTools,
}: {
  node: NodeRow
  nodes: NodeRow[]
  providers: ProviderSummary[]
  messageActionCaptions: boolean
  onChanged: () => void | Promise<void>
  onRegenerate: (id: string) => void
  onGenerateUnder: (id: string) => void
  onAnswerTools: (
    id: string,
    results: Array<{ toolCallId: string; output: unknown }>
  ) => void
}) {
  return (
    <Message
      node={node}
      nodes={nodes}
      providers={providers}
      messageActionCaptions={messageActionCaptions}
      presentation="tree"
      attachSelectionOnEdit={false}
      onChanged={onChanged}
      onRegenerate={
        node.role === "assistant" ? () => onRegenerate(node.id) : undefined
      }
      onGenerateUnder={onGenerateUnder}
      onAnswerTools={onAnswerTools}
    />
  )
})
