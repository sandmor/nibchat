"use client"

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { motion } from "motion/react"
import {
  measureElement as measureVirtualElement,
  useVirtualizer,
} from "@tanstack/react-virtual"
import { ArrowDown02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { NodeRow } from "@/lib/types"
import type { ProviderSummary } from "./types"
import type { MessageComposerBindings } from "./message"
import { Empty } from "./empty"
import { PathSlot } from "./path-slot"
import { StreamingBubble } from "./streaming-bubble"
import {
  buildTranscriptRows,
  pathSlotKey,
  TRANSCRIPT_COLUMN_MAX_WIDTH,
  TRANSCRIPT_SCROLL_TO_END_INSET,
  transcriptEstimatedRowHeight,
  transcriptGeometryChanged,
  transcriptMeasurementLayoutKey,
  transcriptPeekPx,
  transcriptRangeExtractor,
  transcriptRowMeasurementKey,
  TRANSCRIPT_OVERSCAN,
  type TranscriptRow,
} from "./chat-transcript-helpers"
import {
  transcriptHeightCache,
  transcriptHeightEdge,
  transcriptHeightIdentity,
} from "./transcript-height-cache"

/** Distance from the bottom at which the transcript still follows live growth. */
const TRANSCRIPT_LIVE_EDGE_PX = 64
const EMPTY_EDITING_NODE_IDS: ReadonlySet<string> = new Set()

function transcriptRowSpacing(
  density: "comfortable" | "compact",
  index: number,
  count: number
) {
  const first = index === 0
  const last = index === count - 1
  if (density === "compact") {
    return cn("px-3 pb-3 sm:px-4 sm:pb-4", first && "pt-3 sm:pt-4")
  }
  return cn(
    "px-5 pb-5 sm:px-8 sm:pb-5",
    first && "pt-5 sm:pt-8",
    last && "pb-5 sm:pb-8"
  )
}

export type ChatTranscriptProps = {
  /** Remount the virtualizer when switching chats (not on a path tip). */
  chatKey: string
  density: "comfortable" | "compact"
  activePath: NodeRow[]
  nodes: NodeRow[]
  providers: ProviderSummary[]
  streamIdByNodeId: ReadonlyMap<string, string>
  afterTipStreams: Array<{ streamId: string; nodeId: string }>
  showEmpty: boolean
  ariaBusy: boolean
  animate: boolean
  transition: { duration: number; ease: [number, number, number, number] }
  messageActionCaptions: boolean
  /** Open edits stay mounted outside the visual range. */
  editingNodeIds?: ReadonlySet<string>
  /** Explicit navigation target; streaming follow is virtualizer-owned. */
  scrollTargetId: string | null
  onScrollTargetConsumed: () => void
  findLocateKey?: number
  onSelect: (parentId: string, childId: string) => void
  onChanged: () => void | Promise<void>
  onRegenerate: (assistantNodeId: string) => void
  onAnswerTools?: (
    assistantNodeId: string,
    toolResults: Array<{ toolCallId: string; output: unknown }>
  ) => void | Promise<void>
  composer?: MessageComposerBindings
}

export function ChatTranscript(props: ChatTranscriptProps) {
  return <VirtualChatTranscript key={props.chatKey} {...props} />
}

function VirtualChatTranscript({
  density,
  activePath,
  nodes,
  providers,
  streamIdByNodeId,
  afterTipStreams,
  showEmpty,
  ariaBusy,
  animate,
  transition,
  messageActionCaptions,
  editingNodeIds = EMPTY_EDITING_NODE_IDS,
  scrollTargetId,
  onScrollTargetConsumed,
  findLocateKey = 0,
  onSelect,
  onChanged,
  onRegenerate,
  onAnswerTools,
  composer,
}: ChatTranscriptProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const transcriptCanvasRef = useRef<HTMLDivElement>(null)
  const transcriptWidthRef = useRef(0)
  const estimatedWithoutWidthRef = useRef(false)
  const didInitialScrollRef = useRef(false)
  const focusedIndexRef = useRef<number | null>(null)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const [atEnd, setAtEnd] = useState(true)

  const rows = useMemo(
    () =>
      buildTranscriptRows({
        activePath,
        streamIdByNodeId,
        afterTipStreams,
        showEmpty,
      }),
    [activePath, afterTipStreams, showEmpty, streamIdByNodeId]
  )
  const rowIndexByMessageId = useMemo(
    () => new Map(rows.map((row, index) => [row.messageId, index])),
    [rows]
  )
  const rowsRef = useRef(rows)
  const previousRowsRef = useRef(rows)
  const densityRef = useRef(density)
  const messageActionCaptionsRef = useRef(messageActionCaptions)
  rowsRef.current = rows
  densityRef.current = density
  messageActionCaptionsRef.current = messageActionCaptions
  const retainedIndexes = useMemo(() => {
    const retained = new Set<number>()
    for (const nodeId of editingNodeIds) {
      const index = rowIndexByMessageId.get(nodeId)
      if (index != null) retained.add(index)
    }
    rows.forEach((row, index) => {
      if (row.kind === "path" && row.node.status === "awaiting_input")
        retained.add(index)
    })
    if (focusedIndex != null) retained.add(focusedIndex)
    return retained
  }, [editingNodeIds, focusedIndex, rowIndexByMessageId, rows])

  const rangeExtractor = useCallback(
    (range: Parameters<typeof transcriptRangeExtractor>[0]) =>
      transcriptRangeExtractor(range, retainedIndexes),
    [retainedIndexes]
  )

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: (index) => {
      const row = rowsRef.current[index]
      const width = transcriptWidthRef.current
      const cached = transcriptHeightCache.get(
        row ? transcriptHeightIdentity(row) : null,
        {
          width: width || null,
          density: densityRef.current,
          messageActionCaptions: messageActionCaptionsRef.current,
          edge: transcriptHeightEdge(index, rowsRef.current.length),
        }
      )
      if (cached != null) {
        if (!width) estimatedWithoutWidthRef.current = true
        return cached
      }
      if (!width) estimatedWithoutWidthRef.current = true
      return transcriptEstimatedRowHeight(row, width)
    },
    measureElement: (element, entry, instance) => {
      const size = measureVirtualElement(element, entry, instance)
      if (!entry) return size

      const index = instance.indexFromElement(element)
      const row = rowsRef.current[index]
      const box = entry.borderBoxSize?.[0]
      const width = Math.round(box?.inlineSize ?? element.clientWidth)
      if (row) {
        transcriptHeightCache.set(
          transcriptHeightIdentity(row),
          {
            width,
            density: densityRef.current,
            messageActionCaptions: messageActionCaptionsRef.current,
            edge: transcriptHeightEdge(index, rowsRef.current.length),
          },
          size
        )
      }
      return size
    },
    // A transcript item is a path depth. This stays stable through sibling
    // rewrites and after-tip stream promotion; Nibchat does not prepend history.
    getItemKey: pathSlotKey,
    anchorTo: "end",
    followOnAppend: true,
    scrollPaddingStart: transcriptPeekPx(density),
    scrollEndThreshold: TRANSCRIPT_LIVE_EDGE_PX,
    overscan: TRANSCRIPT_OVERSCAN,
    rangeExtractor,
    directDomUpdates: true,
    // Measurement happens from ref callbacks and layout effects; React 19
    // disallows the adapter's default flushSync from those commit phases.
    useFlushSync: false,
    onChange: (instance) => {
      const nextAtEnd = instance.isAtEnd(TRANSCRIPT_LIVE_EDGE_PX)
      setAtEnd((current) => (current === nextAtEnd ? current : nextAtEnd))
    },
  })
  const virtualItems = virtualizer.getVirtualItems()

  const setTranscriptCanvas = useCallback(
    (node: HTMLDivElement | null) => {
      transcriptCanvasRef.current = node
      virtualizer.containerRef(node)
    },
    [virtualizer]
  )

  const measurePreservingVisibleAnchor = useCallback(() => {
    const viewport = viewportRef.current
    const canvas = transcriptCanvasRef.current
    if (!viewport || !canvas) {
      virtualizer.measure()
      return
    }

    const wasAtEnd = virtualizer.isAtEnd(TRANSCRIPT_LIVE_EDGE_PX)
    const scrollOffset = viewport.scrollTop
    const visibleItem = wasAtEnd
      ? undefined
      : virtualizer.getVirtualItemForOffset(scrollOffset)
    const anchor = visibleItem
      ? {
          index: visibleItem.index,
          offsetWithinRow: scrollOffset - visibleItem.start,
        }
      : null

    virtualizer.measure()

    // A full reset discards even mounted sizes. Re-read them through the public
    // measurement API so the restored anchor never waits for ResizeObserver.
    for (const element of canvas.querySelectorAll<HTMLDivElement>(
      ":scope > [data-index]"
    )) {
      virtualizer.measureElement(element)
    }

    if (wasAtEnd) {
      virtualizer.scrollToEnd({ behavior: "auto" })
      return
    }

    if (!anchor) return
    // getVirtualItems rebuilds the full measurement list. The anchored row
    // may have left the overscan window after offscreen estimates changed.
    void virtualizer.getVirtualItems()
    const nextAnchor = virtualizer.measurementsCache[anchor.index]
    if (!nextAnchor) return
    virtualizer.scrollToOffset(nextAnchor.start + anchor.offsetWithinRow, {
      behavior: "auto",
    })
  }, [virtualizer])

  // Cached heights are width-specific. Rebuild estimated geometry after a
  // resize while keeping the reader on the same visible row.
  useLayoutEffect(() => {
    const canvas = transcriptCanvasRef.current
    if (!canvas || typeof ResizeObserver === "undefined") return

    const updateWidth = (width: number) => {
      const nextWidth = Math.round(width)
      if (nextWidth <= 0 || nextWidth === transcriptWidthRef.current) return
      const previousWidth = transcriptWidthRef.current
      transcriptWidthRef.current = nextWidth
      if (previousWidth > 0 || estimatedWithoutWidthRef.current) {
        estimatedWithoutWidthRef.current = false
        measurePreservingVisibleAnchor()
      }
    }

    updateWidth(canvas.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      const box = entry?.borderBoxSize?.[0]
      updateWidth(box?.inlineSize ?? entry?.contentRect.width ?? 0)
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [measurePreservingVisibleAnchor])

  // Slot keys deliberately survive a sibling branch replacement. That avoids a
  // content crossfade remount, but it also means TanStack cannot infer that an
  // offscreen slot's old height belongs to a different message. Reset durable
  // geometry before paint; streaming token growth remains ResizeObserver-owned.
  useLayoutEffect(() => {
    const previousRows = previousRowsRef.current
    previousRowsRef.current = rows
    if (!transcriptGeometryChanged(previousRows, rows)) return
    measurePreservingVisibleAnchor()
  }, [measurePreservingVisibleAnchor, rows])

  // Density and action captions change every row. Path rewrites do not: the
  // slot shell remeasures on contentKey so a scrolled-away viewport stays put.
  const measurementLayoutSignature = transcriptMeasurementLayoutKey(
    density,
    messageActionCaptions
  )
  const previousMeasurementLayoutRef = useRef(measurementLayoutSignature)
  useLayoutEffect(() => {
    if (previousMeasurementLayoutRef.current === measurementLayoutSignature)
      return
    previousMeasurementLayoutRef.current = measurementLayoutSignature
    measurePreservingVisibleAnchor()
  }, [measurementLayoutSignature, measurePreservingVisibleAnchor])

  // Start each chat at its latest row. The keyed child remounts only on chat
  // change, not on path rewrites or streaming updates.
  useLayoutEffect(() => {
    if (didInitialScrollRef.current || rows.length === 0) return
    virtualizer.scrollToEnd({ behavior: "auto" })
    didInitialScrollRef.current = true
  }, [rows.length, virtualizer])

  // Targets may be offscreen: resolve the row index, scroll it into the
  // virtual range, then let ConversationFindLayer paint after it mounts.
  useLayoutEffect(() => {
    if (!scrollTargetId) return
    const targetIndex = rowIndexByMessageId.get(scrollTargetId)
    if (targetIndex == null) return
    virtualizer.scrollToIndex(targetIndex, {
      align: "start",
      behavior: "auto",
    })
    onScrollTargetConsumed()
  }, [
    findLocateKey,
    onScrollTargetConsumed,
    rowIndexByMessageId,
    scrollTargetId,
    virtualizer,
  ])

  const syncFocusedIndex = useCallback((element: Element | null) => {
    const raw = element?.getAttribute("data-index")
    const index = raw == null ? null : Number(raw)
    const next = Number.isInteger(index) ? index : null
    focusedIndexRef.current = next
    setFocusedIndex((current) => (current === next ? current : next))
  }, [])

  const onBlurCapture = useCallback(() => {
    requestAnimationFrame(() => {
      const active = document.activeElement
      const row = active?.closest?.("[data-index]") ?? null
      if (row instanceof Element) syncFocusedIndex(row)
      else if (focusedIndexRef.current != null) syncFocusedIndex(null)
    })
  }, [syncFocusedIndex])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={viewportRef}
        data-testid="chat-transcript-viewport"
        role="region"
        aria-label="Messages"
        tabIndex={0}
        onBlurCapture={onBlurCapture}
        onFocusCapture={(event) =>
          syncFocusedIndex((event.target as Element).closest("[data-index]"))
        }
        className="size-full min-h-0 min-w-0 scroll-fade-b scrollbar-thin scrollbar-gutter-stable overflow-y-auto overscroll-contain contain-content"
      >
        <div
          ref={setTranscriptCanvas}
          role="list"
          aria-busy={ariaBusy}
          className="relative mx-auto w-full max-w-none min-w-0"
          style={{ maxWidth: TRANSCRIPT_COLUMN_MAX_WIDTH }}
        >
          {virtualItems.map((virtualItem) => {
            const row = rows[virtualItem.index]
            if (!row) return null
            return (
              <TranscriptVirtualRow
                key={virtualItem.key}
                row={row}
                index={virtualItem.index}
                count={rows.length}
                density={density}
                measureElement={virtualizer.measureElement}
              >
                {row.kind === "empty" ? (
                  <motion.div
                    key="empty"
                    initial={animate ? { opacity: 0 } : false}
                    animate={{ opacity: 1 }}
                    transition={transition}
                  >
                    <Empty providers={providers} />
                  </motion.div>
                ) : row.kind === "after-tip" ? (
                  <StreamingBubble
                    streamId={row.streamId}
                    animate={animate}
                    transition={transition}
                  />
                ) : (
                  <PathSlot
                    row={row}
                    nodes={nodes}
                    providers={providers}
                    animate={animate}
                    transition={transition}
                    messageActionCaptions={messageActionCaptions}
                    onSelect={onSelect}
                    onChanged={onChanged}
                    onRegenerate={onRegenerate}
                    onAnswerTools={onAnswerTools}
                    composer={composer}
                  />
                )}
              </TranscriptVirtualRow>
            )
          })}
        </div>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        data-testid="chat-scroll-to-end"
        data-active={atEnd ? "false" : "true"}
        aria-label="Scroll to end"
        tabIndex={atEnd ? -1 : undefined}
        inert={atEnd ? true : undefined}
        onClick={() => virtualizer.scrollToEnd({ behavior: "smooth" })}
        style={{ insetInlineEnd: TRANSCRIPT_SCROLL_TO_END_INSET }}
        className="absolute bottom-3 z-10 border-border bg-background text-foreground shadow-[var(--tree-shadow-sm)] transition-[translate,scale,opacity] duration-200 hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:translate-y-full data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] sm:bottom-4"
      >
        <HugeiconsIcon icon={ArrowDown02Icon} strokeWidth={2} />
      </Button>
    </div>
  )
}

function TranscriptVirtualRow({
  row,
  index,
  count,
  density,
  measureElement,
  children,
}: {
  row: TranscriptRow
  index: number
  count: number
  density: "comfortable" | "compact"
  measureElement: (node: HTMLDivElement | null) => void
  children: ReactNode
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const measurementKey = transcriptRowMeasurementKey(row)

  // A sibling replacement reuses the shell, so its callback ref does not run.
  // Measure synchronously before paint; ResizeObserver handles later reflows.
  useLayoutEffect(() => {
    measureElement(rowRef.current)
  }, [measurementKey, measureElement])

  return (
    <div
      ref={(node) => {
        rowRef.current = node
        measureElement(node)
      }}
      data-index={index}
      role="listitem"
      aria-posinset={index + 1}
      aria-setsize={count}
      className={cn(
        "absolute top-0 left-0 w-full min-w-0",
        transcriptRowSpacing(density, index, count)
      )}
    >
      {children}
    </div>
  )
}
