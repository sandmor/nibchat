"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
import { ComposeSlot, TreeHandoff } from "./tree-card"
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
  type TreeLayout,
  type TreeRect,
} from "./tree-layout"
import {
  PAN_THRESHOLD,
  centerOnRect,
  nodePaint,
  panBy,
  rectFullyVisible,
  rectsOverlap,
  wheelTargetScrolls,
  worldViewRect,
  zoomToward,
  type Camera,
} from "./tree-camera"

const CHROME_SELECTOR =
  "button,a,input,textarea,select,[role=dialog],[data-tree-chrome]"

export function ChatTree({
  nodes,
  activePath,
  draftAnchors,
  providers,
  streamIdByNodeId,
  animate,
  transition,
  messageActionCaptions,
  renderComposer,
  onOpenDraft,
  onSendDraft,
  messageLayoutIds = {},
  onHandoffComplete,
  onChanged,
  onRegenerate,
  onGenerateUnder,
  onAnswerTools,
  onStop,
}: {
  nodes: NodeRow[]
  activePath: NodeRow[]
  draftAnchors: ReadonlySet<string | null>
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
  const [camera, setCamera] = useState<Camera>({ x: 48, y: 36, scale: 0.82 })
  const [smoothCamera, setSmoothCamera] = useState(false)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [sizes, setSizes] = useState<ReadonlyMap<string, number>>(
    () => new Map()
  )
  const didCenter = useRef(false)
  const cameraRef = useRef(camera)
  const draftHeightsRef = useRef(new Map<string, number>())
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
    () => layoutChatTree(nodes, { draftAnchors, sizes }),
    [nodes, draftAnchors, sizes]
  )
  const pathIds = useMemo(
    () => new Set(activePath.map((node) => node.id)),
    [activePath]
  )
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes]
  )
  const handoffs = collectHandoffs(
    messageLayoutIds,
    new Set(nodesById.keys()),
    composeSources,
    layout.rects
  )
  const handoffByAnchor = new Map(
    handoffs.map((item) => [item.anchor, item] as const)
  )
  const handoffNodeIds = new Set(handoffs.map((item) => item.userNodeId))

  useEffect(() => {
    cameraRef.current = camera
  }, [camera])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const update = () =>
      setViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const viewportPoint = (clientX: number, clientY: number) => {
    const box = viewportRef.current?.getBoundingClientRect()
    if (!box) return { x: 0, y: 0 }
    return { x: clientX - box.left, y: clientY - box.top }
  }

  const moveCamera = useCallback(
    (next: Camera, immediate = false) => {
      const current = cameraRef.current
      if (
        current.x === next.x &&
        current.y === next.y &&
        current.scale === next.scale
      )
        return
      setSmoothCamera(Boolean(animate && !immediate))
      setCamera(next)
    },
    [animate, setCamera, setSmoothCamera]
  )

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
        scale ?? Math.max(current.scale, 0.78)
      )
      moveCamera(next, immediate)
    },
    [layout, moveCamera]
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
    const tip = activePath.at(-1)?.id
    if (!tip || !layout.rects.has(tip) || !viewportRef.current) return
    didCenter.current = true
    setFocusedId(tip)
    centerOn(tip, undefined, true)
    // One-shot camera: tree focus is independent from later linear selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, activePath])

  useLayoutEffect(() => {
    const world = worldRef.current
    if (!world) return
    const observer = new ResizeObserver((entries) => {
      setSizes((current) => {
        let changed = false
        const next = new Map(current)
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.treeSize
          if (!id) continue
          const height = Math.round((entry.target as HTMLElement).offsetHeight)
          if (next.get(id) !== height) {
            next.set(id, height)
            changed = true
          }
        }
        return changed ? next : current
      })
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

  const focusNode = (id: string) => {
    setFocusedId(id)
    frameRectIfNeeded(id)
  }

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
      if (wheelTargetScrolls(event.target, event.deltaX, event.deltaY)) return
      event.preventDefault()
      setSmoothCamera(false)
      const point = viewportPoint(event.clientX, event.clientY)
      if (event.ctrlKey || event.metaKey) {
        setCamera((current) =>
          zoomToward(current, event.deltaY > 0 ? 0.9 : 1.1, point)
        )
        return
      }
      setCamera((current) => panBy(current, -event.deltaX, -event.deltaY))
    }
    viewport.addEventListener("wheel", onWheel, { passive: false })
    return () => viewport.removeEventListener("wheel", onWheel)
  }, [])

  const transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`
  const viewRect = worldViewRect(camera, viewportSize)
  const visible = (rect: TreeRect) => rectsOverlap(rect, viewRect, 240)

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
          setSmoothCamera(false)
          setCamera((current) => panBy(current, dx, dy))
          return
        }
        drag.current = { ...state, x: event.clientX, y: event.clientY }
        setCamera((current) => panBy(current, dx, dy))
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
        focusNode(hitId)
      }}
      onPointerCancel={(event) => {
        drag.current = null
        delete event.currentTarget.dataset.panning
      }}
    >
      <div
        ref={worldRef}
        className="absolute origin-top-left will-change-transform"
        style={{
          width: layout.bounds.width,
          height: layout.bounds.height,
          transform,
          transition:
            smoothCamera && animate
              ? `transform ${transition.duration}s cubic-bezier(${transition.ease.join(",")})`
              : undefined,
        }}
        onTransitionEnd={(event) => {
          if (event.propertyName === "transform") setSmoothCamera(false)
        }}
      >
        <svg
          className="pointer-events-none absolute inset-0 overflow-visible"
          width={layout.bounds.width}
          height={layout.bounds.height}
          aria-hidden
        >
          {layout.edges.map((edge) => {
            const from = layout.rects.get(edge.from)
            const to = layout.rects.get(edge.to)
            if (!from || !to) return null
            const x1 = from.x + from.width / 2
            const y1 = from.y + from.height
            const x2 = to.x + to.width / 2
            const y2 = to.y
            const d = `M ${x1} ${y1} C ${x1} ${y1 + 28}, ${x2} ${y2 - 28}, ${x2} ${y2}`
            return animate ? (
              <motion.path
                key={`${edge.from}:${edge.to}`}
                initial={false}
                animate={{ d }}
                transition={transition}
                fill="none"
                className={cn(
                  "stroke-[var(--tree-edge-color)] stroke-2",
                  pathIds.has(edge.from) &&
                    pathIds.has(edge.to) &&
                    "stroke-[var(--tree-active-color)]"
                )}
              />
            ) : (
              <path
                key={`${edge.from}:${edge.to}`}
                d={d}
                fill="none"
                className={cn(
                  "stroke-[var(--tree-edge-color)] stroke-2",
                  pathIds.has(edge.from) &&
                    pathIds.has(edge.to) &&
                    "stroke-[var(--tree-active-color)]"
                )}
              />
            )
          })}
        </svg>
        {nodes.map((node) => {
          if (handoffNodeIds.has(node.id)) return null
          const rect = layout.rects.get(node.id)
          if (!rect || !visible(rect)) return null
          const streamId = streamIdByNodeId.get(node.id)
          const focused = focusedId === node.id
          const paint = nodePaint({
            rect,
            scale: camera.scale,
            interactive:
              Boolean(streamId) ||
              node.status === "awaiting_input" ||
              node.status === "streaming",
          })
          const maxHeight = cardMaxHeight(node)
          const live = paint !== "stub"
          return (
            <motion.div
              key={node.id}
              data-tree-hit={node.id}
              data-tree-size={live ? node.id : undefined}
              data-tree-scroll={live ? "" : undefined}
              className={cn(
                "absolute rounded-xl",
                live
                  ? "[touch-action:pan-x_pan-y] overflow-auto overscroll-contain select-text"
                  : "cursor-pointer overflow-hidden",
                focused && "z-10 ring-2 ring-[var(--tree-focus-color)]",
                pathIds.has(node.id) &&
                  !focused &&
                  "shadow-[0_0_0_1px_var(--tree-path-color)]"
              )}
              initial={false}
              animate={{
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: live ? "auto" : rect.height,
              }}
              style={{ maxHeight }}
              transition={animate ? transition : { duration: 0 }}
            >
              {streamId ? (
                <StreamingBubble
                  streamId={streamId}
                  animate={animate}
                  transition={transition}
                />
              ) : paint === "stub" ? (
                <div
                  className={cn(
                    "h-full w-full rounded-xl border",
                    pathIds.has(node.id)
                      ? "border-[var(--tree-active-color)] bg-[var(--tree-active-surface)]"
                      : "border-message-assistant-border bg-message-assistant"
                  )}
                />
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
            if (!open && !visible(rect)) return null
            return (
              <ComposeSlot
                key={id}
                id={id}
                open={open}
                rect={rect}
                animate={animate}
                transition={transition}
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
            setSmoothCamera(false)
            setCamera((current) => zoomToward(current, 1.15, point))
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
            setSmoothCamera(false)
            setCamera((current) => zoomToward(current, 1 / 1.15, point))
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
        camera={camera}
        viewportSize={viewportSize}
        focusedId={focusedId}
        pathIds={pathIds}
        onJump={(id) => {
          setFocusedId(id)
          centerOn(id)
        }}
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
            camera={camera}
            viewportSize={viewportSize}
            focusedId={focusedId}
            pathIds={pathIds}
            onJump={(id) => {
              setFocusedId(id)
              centerOn(id)
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
  camera,
  viewportSize,
  focusedId,
  pathIds,
  onJump,
  className,
}: {
  layout: TreeLayout
  camera: Camera
  viewportSize: { width: number; height: number }
  focusedId: string | null
  pathIds: Set<string>
  onJump: (id: string) => void
  className: string
}) {
  const width = Math.max(1, layout.bounds.width)
  const height = Math.max(1, layout.bounds.height)
  const view =
    viewportSize.width > 0 ? worldViewRect(camera, viewportSize) : null
  return (
    <div data-tree-chrome className={className}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-28 w-full overflow-hidden rounded-md bg-[var(--tree-minimap-background)]"
        data-theme-target="tree-minimap-background"
        role="img"
        aria-label="Conversation minimap"
      >
        {layout.edges.map((edge) => {
          const a = layout.rects.get(edge.from)
          const b = layout.rects.get(edge.to)
          return a && b ? (
            <line
              key={`${edge.from}:${edge.to}`}
              x1={a.x + a.width / 2}
              y1={a.y + a.height}
              x2={b.x + b.width / 2}
              y2={b.y}
              className="stroke-[var(--tree-minimap-edge)]"
              data-theme-target="tree-minimap-edge"
              vectorEffect="non-scaling-stroke"
              strokeWidth={1.25}
            />
          ) : null
        })}
        {[...layout.rects.entries()]
          .filter(([id]) => !isAddId(id))
          .map(([id, rect]) => {
            const target =
              focusedId === id
                ? "tree-minimap-focus"
                : pathIds.has(id)
                  ? "tree-minimap-path"
                  : "tree-minimap-node"
            return (
              <rect
                key={id}
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                rx={10}
                data-theme-target={target}
                className={cn(
                  "cursor-pointer fill-[var(--tree-minimap-node)]",
                  pathIds.has(id) && "fill-[var(--tree-minimap-path)]",
                  focusedId === id &&
                    "fill-[var(--tree-minimap-focus)] stroke-[var(--tree-viewport-color)]"
                )}
                vectorEffect={
                  focusedId === id ? "non-scaling-stroke" : undefined
                }
                strokeWidth={focusedId === id ? 1.5 : undefined}
                onClick={() => onJump(id)}
              />
            )
          })}
        {view ? (
          <rect
            x={view.x}
            y={view.y}
            width={view.width}
            height={view.height}
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

function TreeMessage({
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
}
