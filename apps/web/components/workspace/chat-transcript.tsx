"use client"

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { motion } from "motion/react"
import {
  measureElement as measureVirtualElement,
  useVirtualizer,
  type Virtualizer,
} from "@tanstack/react-virtual"
import { ArrowDown02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { NodeRow } from "@/lib/types"
import type { ProviderSummary } from "./types"
import { Message, type MessageEditorBindings } from "./message"
import {
  ScheduledGenerationLane,
  useScheduledGeneration,
} from "./scheduled-generation"
import { useWorkspaceChrome } from "./shell"
import { Empty } from "./empty"
import { PathSlot } from "./path-slot"
import { StreamingBubble } from "./streaming-bubble"
import {
  buildTranscriptRows,
  transcriptItemKey,
  TRANSCRIPT_COLUMN_MAX_WIDTH,
  TRANSCRIPT_SCROLL_TO_END_INSET,
  transcriptEstimatedRowHeight,
  transcriptMeasurementLayoutKey,
  transcriptPeekPx,
  transcriptRangeExtractor,
  transcriptRowMeasurementKey,
  transcriptSiblingsByNodeId,
  TRANSCRIPT_OVERSCAN,
  type AfterTipTranscriptRow,
  type TranscriptRow,
} from "./chat-transcript-helpers"
import {
  transcriptHeightCache,
  transcriptHeightEdge,
  transcriptHeightIdentity,
} from "./transcript-height-cache"
import {
  useTranscriptViewport,
  type TranscriptAtEnd,
} from "./use-transcript-viewport"

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
  /** Persisting this draft retains its reader; opening another chat resets it. */
  creatingChat: boolean
  density: "comfortable" | "compact"
  activePath: NodeRow[]
  nodes: NodeRow[]
  providers: ProviderSummary[]
  streamIdByNodeId: ReadonlyMap<string, string>
  afterTipStreams: Array<{ streamId: string; nodeId: string }>
  showEmpty: boolean
  emptyHint?: string
  ariaBusy: boolean
  animate: boolean
  transition: { duration: number; ease: [number, number, number, number] }
  messageActionCaptions: boolean
  /** Open edits stay mounted outside the visual range. */
  editingNodeIds?: ReadonlySet<string>
  /** Explicit navigation target, resolved by the viewport controller. */
  scrollTargetId: string | null
  onScrollTargetConsumed: () => void
  findLocateKey?: number
  onSelect: (parentId: string, childId: string) => void | Promise<void>
  onChanged: () => void | Promise<void>
  onGenerateReplies: (nodeId: string | null, count?: number) => void
  onAnswerTools?: (
    assistantNodeId: string,
    toolResults: Array<{ toolCallId: string; output: unknown }>
  ) => void | Promise<void>
  editor?: MessageEditorBindings
}

export function ChatTranscript(props: ChatTranscriptProps) {
  return <VirtualChatTranscript key={props.chatKey} {...props} />
}

function VirtualChatTranscript({
  chatKey,
  creatingChat,
  density,
  activePath,
  nodes,
  providers,
  streamIdByNodeId,
  afterTipStreams,
  showEmpty,
  emptyHint,
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
  onGenerateReplies,
  onAnswerTools,
  editor,
}: ChatTranscriptProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const { appearance } = useWorkspaceChrome()
  const heightLayoutKey = useMemo(
    () =>
      JSON.stringify([
        appearance.messageLayout,
        appearance.modelPicker.showIds,
        appearance.remoteStylesheet,
      ]),
    [
      appearance.messageLayout,
      appearance.modelPicker.showIds,
      appearance.remoteStylesheet,
    ]
  )
  const transcriptCanvasRef = useRef<HTMLDivElement>(null)
  const didInitialScrollRef = useRef(false)
  const focusedIndexRef = useRef<number | null>(null)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const notifyMeasurementsRef = useRef(() => {})
  const contentSizeRef = useRef(-1)
  const [retainedSlotKey, setRetainedSlotKey] = useState<string | null>(null)

  const scheduledGeneration = useScheduledGeneration()
  const rows = useMemo(() => {
    return buildTranscriptRows({
      activePath,
      streamIdByNodeId,
      afterTipStreams,
      showEmpty,
    })
  }, [activePath, afterTipStreams, showEmpty, streamIdByNodeId])
  const rowIndexByMessageId = useMemo(
    () => new Map(rows.map((row, index) => [row.messageId, index])),
    [rows]
  )
  const siblingsByNodeId = useMemo(
    () => transcriptSiblingsByNodeId(nodes),
    [nodes]
  )
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
    if (retainedSlotKey) {
      const index = rows.findIndex(
        (_, index) => transcriptItemKey(rows, index) === retainedSlotKey
      )
      if (index >= 0) retained.add(index)
    }
    return retained
  }, [editingNodeIds, focusedIndex, rowIndexByMessageId, rows, retainedSlotKey])

  const rangeExtractor = useCallback(
    (range: Parameters<typeof transcriptRangeExtractor>[0]) =>
      transcriptRangeExtractor(
        range,
        retainedIndexes,
        !didInitialScrollRef.current
      ),
    [retainedIndexes]
  )

  const rowsRef = useRef(rows)
  const densityRef = useRef(density)
  const messageActionCaptionsRef = useRef(messageActionCaptions)
  const heightLayoutKeyRef = useRef(heightLayoutKey)
  const widthRef = useRef(0)
  rowsRef.current = rows
  densityRef.current = density
  messageActionCaptionsRef.current = messageActionCaptions
  heightLayoutKeyRef.current = heightLayoutKey

  // Stable identities keep TanStack's measurement memo intact across commits
  // that do not change row count, padding, or measured sizes.
  const estimateSize = useCallback((index: number) => {
    const currentRows = rowsRef.current
    const row = currentRows[index]
    const width = widthRef.current
    const cached = transcriptHeightCache.get(
      row ? transcriptHeightIdentity(row) : null,
      {
        width: width || null,
        density: densityRef.current,
        messageActionCaptions: messageActionCaptionsRef.current,
        layoutKey: heightLayoutKeyRef.current,
        edge: transcriptHeightEdge(index, currentRows.length),
      }
    )
    if (cached != null) return cached
    return transcriptEstimatedRowHeight(row, width)
  }, [])
  const measureRow = useCallback(
    (
      element: HTMLDivElement,
      entry: ResizeObserverEntry | undefined,
      instance: Virtualizer<HTMLDivElement, HTMLDivElement>
    ) => {
      const size = measureVirtualElement(element, entry, instance)
      if (!entry) return size

      const index = instance.indexFromElement(element)
      const currentRows = rowsRef.current
      const row = currentRows[index]
      const identity = row ? transcriptHeightIdentity(row) : null
      const box = entry.borderBoxSize?.[0]
      const width = Math.round(box?.inlineSize ?? element.clientWidth)
      // Editors and expanded activity are transient layouts. Only reuse the
      // ordinary collapsed message height after a virtual row remounts.
      if (
        identity &&
        element.querySelector("article") &&
        !element.querySelector("details[open]")
      ) {
        transcriptHeightCache.set(
          identity,
          {
            width,
            density: densityRef.current,
            messageActionCaptions: messageActionCaptionsRef.current,
            layoutKey: heightLayoutKeyRef.current,
            edge: transcriptHeightEdge(index, currentRows.length),
          },
          size
        )
      }
      return size
    },
    []
  )
  const getItemKey = useCallback(
    (index: number) => transcriptItemKey(rowsRef.current, index),
    []
  )

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize,
    measureElement: measureRow,
    // A path row stays keyed by depth when a scheduled sibling is inserted
    // above it. An after-tip stream keeps the slot it joins once promoted.
    getItemKey,
    // TanStack measures and places rows; the viewport model owns scroll policy.
    // Re-enabling any virtualizer scroll writer violates the single-writer contract.
    anchorTo: "start",
    followOnAppend: false,
    // Includes initialization and effect replay, which otherwise write offsets
    // even with append following and resize compensation disabled.
    scrollToFn: () => {},
    scrollPaddingStart: transcriptPeekPx(density),
    overscan: TRANSCRIPT_OVERSCAN,
    rangeExtractor,
    directDomUpdates: true,
    // Native sticky tabs must share the scrollport's layout coordinates.
    // Translated rows would displace them by the virtual item's offset.
    directDomUpdatesMode: "position",
    // Measurement happens from ref callbacks and layout effects; React 19
    // disallows the adapter's default flushSync from those commit phases.
    useFlushSync: false,
    onChange: (instance) => {
      // Scroll notifications share this callback. Range movement leaves the
      // total unchanged; a resize changes the public total and needs a pass.
      const total = instance.getTotalSize()
      if (total === contentSizeRef.current) return
      contentSizeRef.current = total
      notifyMeasurementsRef.current()
    },
  })
  // Ref measurement runs before layout effects. The flag has to be in place
  // during render or the first sizes also move the virtualizer's own offset.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false
  const viewport = useTranscriptViewport({
    chatKey,
    creatingChat,
    rows,
    layoutKey:
      heightLayoutKey +
      transcriptMeasurementLayoutKey(density, messageActionCaptions),
    viewportRef,
    canvasRef: transcriptCanvasRef,
    widthRef,
    contentSizeRef,
    virtualizer,
    scrollTargetId,
    findLocateKey,
    onScrollTargetConsumed,
    onSelect,
    onRetainedSlotChange: setRetainedSlotKey,
  })
  notifyMeasurementsRef.current = viewport.notifyMeasurements
  useLayoutEffect(() => {
    didInitialScrollRef.current = true
  }, [])
  const virtualItems = virtualizer.getVirtualItems()

  const setTranscriptCanvas = useCallback(
    (node: HTMLDivElement | null) => {
      transcriptCanvasRef.current = node
      virtualizer.containerRef(node)
    },
    [virtualizer]
  )

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
        data-transcript-viewport=""
        data-testid="chat-transcript-viewport"
        role="region"
        aria-label="Messages"
        tabIndex={0}
        onBlurCapture={onBlurCapture}
        onFocusCapture={(event) =>
          syncFocusedIndex((event.target as Element).closest("[data-index]"))
        }
        className="size-full min-h-0 min-w-0 scroll-fade-b scrollbar-thin scrollbar-gutter-stable overflow-y-auto overscroll-contain contain-content [overflow-anchor:none]"
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
                    <Empty providers={providers} hint={emptyHint} />
                  </motion.div>
                ) : row.kind === "scheduled" ? (
                  <ScheduledGenerationLane
                    items={row.items}
                    verb={row.verb}
                    captions={messageActionCaptions}
                    onOpen={(scheduleId) =>
                      scheduledGeneration?.openPending(scheduleId)
                    }
                  />
                ) : row.kind === "after-tip" ? (
                  <AfterTipSlot
                    row={row}
                    nodes={nodes}
                    siblingNodes={siblingsByNodeId.get(row.messageId)}
                    providers={providers}
                    animate={animate}
                    transition={transition}
                    messageActionCaptions={messageActionCaptions}
                    slotKey={String(virtualItem.key)}
                    registerStepper={viewport.registerStepper}
                    onSelect={viewport.selectVersion}
                    onChanged={onChanged}
                    onGenerateReplies={onGenerateReplies}
                    onAnswerTools={onAnswerTools}
                    editor={editor}
                  />
                ) : (
                  <PathSlot
                    row={row}
                    nodes={nodes}
                    siblingNodes={siblingsByNodeId.get(row.node.id)}
                    providers={providers}
                    animate={animate}
                    transition={transition}
                    messageActionCaptions={messageActionCaptions}
                    slotKey={String(virtualItem.key)}
                    registerStepper={viewport.registerStepper}
                    onSelect={viewport.selectVersion}
                    onChanged={onChanged}
                    onGenerateReplies={onGenerateReplies}
                    onAnswerTools={onAnswerTools}
                    editor={editor}
                  />
                )}
              </TranscriptVirtualRow>
            )
          })}
        </div>
      </div>
      <TranscriptScrollToEnd
        atEnd={viewport.atEnd}
        onClick={viewport.jumpToEnd}
      />
    </div>
  )
}

function TranscriptScrollToEnd({
  atEnd,
  onClick,
}: {
  atEnd: TranscriptAtEnd
  onClick: () => void
}) {
  const following = useSyncExternalStore(atEnd.subscribe, atEnd.get, atEnd.get)
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon-sm"
      data-testid="chat-scroll-to-end"
      data-active={following ? "false" : "true"}
      aria-label="Scroll to end"
      tabIndex={following ? -1 : undefined}
      inert={following ? true : undefined}
      // An explicit jump is a recovery action. Commit it immediately so a
      // changing stream cannot keep a smooth-scroll target perpetually stale.
      onClick={onClick}
      style={{ insetInlineEnd: TRANSCRIPT_SCROLL_TO_END_INSET }}
      className="absolute bottom-3 z-10 border-border bg-background text-foreground shadow-[var(--tree-shadow-sm)] transition-[translate,scale,opacity] duration-200 hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:translate-y-full data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] sm:bottom-4"
    >
      <HugeiconsIcon icon={ArrowDown02Icon} strokeWidth={2} />
    </Button>
  )
}

function AfterTipSlot({
  row,
  nodes,
  siblingNodes,
  providers,
  animate,
  transition,
  messageActionCaptions,
  slotKey,
  registerStepper,
  onSelect,
  onChanged,
  onGenerateReplies,
  onAnswerTools,
  editor,
}: {
  row: AfterTipTranscriptRow
  nodes: NodeRow[]
  siblingNodes?: readonly NodeRow[]
  providers: ProviderSummary[]
  animate: boolean
  transition: { duration: number; ease: [number, number, number, number] }
  messageActionCaptions: boolean
  slotKey: string
  registerStepper: (key: string, element: HTMLElement | null) => void
  onSelect: (
    slotKey: string,
    parentId: string,
    childId: string
  ) => Promise<void>
  onChanged: () => void | Promise<void>
  onGenerateReplies: (nodeId: string | null, count?: number) => void
  onAnswerTools?: (
    assistantNodeId: string,
    toolResults: Array<{ toolCallId: string; output: unknown }>
  ) => void | Promise<void>
  editor?: MessageEditorBindings
}) {
  const handleGenerateReplies = useCallback(
    (count?: number) => onGenerateReplies(row.messageId, count),
    [onGenerateReplies, row.messageId]
  )
  const handleRegenerate = useCallback(
    (count?: number) => {
      const parentId =
        nodes.find((candidate) => candidate.id === row.messageId)?.parent_id ??
        null
      onGenerateReplies(parentId, count)
    },
    [nodes, onGenerateReplies, row.messageId]
  )
  const stepperRef = useCallback(
    (element: HTMLSpanElement | null) => registerStepper(slotKey, element),
    [registerStepper, slotKey]
  )
  const selectVersion = useCallback(
    (parentId: string, childId: string) => {
      void onSelect(slotKey, parentId, childId)
    },
    [onSelect, slotKey]
  )
  const node = nodes.find((candidate) => candidate.id === row.messageId)
  if (!node) {
    return (
      <StreamingBubble
        streamId={row.streamId}
        animate={animate}
        transition={transition}
      />
    )
  }
  return (
    <Message
      node={node}
      nodes={nodes}
      siblingNodes={siblingNodes}
      providers={providers}
      messageActionCaptions={messageActionCaptions}
      animate={animate}
      transition={transition}
      onSelect={selectVersion}
      stepperRef={stepperRef}
      onChanged={onChanged}
      onGenerateReplies={handleGenerateReplies}
      onRegenerate={handleRegenerate}
      onAnswerTools={onAnswerTools}
      editor={editor}
      streamId={row.streamId}
    />
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
