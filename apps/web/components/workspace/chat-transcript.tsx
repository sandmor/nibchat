"use client"

import { useLayoutEffect, useMemo } from "react"
import { motion } from "motion/react"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller"
import { cn } from "@/lib/utils"
import type { NodeRow } from "@/lib/types"
import type { ProviderSummary } from "./types"
import { Empty } from "./empty"
import { PathSlot } from "./path-slot"
import { StreamingBubble } from "./streaming-bubble"
import {
  buildTranscriptRows,
  isScrollTargetMounted,
  LIVE_ROW_CLASS,
  mountedTranscriptMessageIds,
  transcriptPeekPx,
  type LiveStreamEntry,
} from "./chat-transcript-helpers"

export {
  isScrollAnchorRole,
  isScrollTargetMounted,
  chatRouteIdentity,
  pathSlotKey,
  buildTranscriptRows,
  mountedTranscriptMessageIds,
  transcriptPeekPx,
} from "./chat-transcript-helpers"

export { StreamingBubble } from "./streaming-bubble"

function ScrollTargetEffect({
  scrollTargetId,
  targetMounted,
  onScrollTargetConsumed,
  /** When the path settles (deep link / branch), retry pending jumps. */
  pathSignature,
}: {
  scrollTargetId: string | null
  targetMounted: boolean
  onScrollTargetConsumed: () => void
  pathSignature: string
}) {
  const { scrollToMessage } = useMessageScroller()

  // Layout so the MessageScrollerItem ref has registered before we jump.
  // Only fire when the row is in our React tree — never clear on empty-queue
  // success (that is lost if MessageScrollerProvider remounts).
  useLayoutEffect(() => {
    if (!scrollTargetId || !targetMounted) return
    const ok = scrollToMessage(scrollTargetId, {
      align: "start",
      behavior: "auto",
    })
    if (ok) onScrollTargetConsumed()
  }, [
    scrollTargetId,
    targetMounted,
    pathSignature,
    scrollToMessage,
    onScrollTargetConsumed,
  ])

  return null
}

export type ChatTranscriptProps = {
  /** Remount scroller when switching chats (not on path tip). */
  chatKey: string
  density: "comfortable" | "compact"
  activePath: NodeRow[]
  nodes: NodeRow[]
  providers: ProviderSummary[]
  streamByNodeId: Map<string, LiveStreamEntry>
  afterTipStreams: LiveStreamEntry[]
  showEmpty: boolean
  ariaBusy: boolean
  animate: boolean
  transition: { duration: number; ease: [number, number, number, number] }
  messageActionCaptions: boolean
  /**
   * Explicit navigation target (deep link, branch pick). Null for stream
   * soft-follow so viewport follow stays intent-based (MessageScroller autoScroll).
   */
  scrollTargetId: string | null
  onScrollTargetConsumed: () => void
  onSelect: (parentId: string, childId: string) => void
  onChanged: () => void | Promise<void>
  onRegenerate: (assistantNodeId: string) => void
  onGenerateUnder: (parentNodeId: string) => void | Promise<void>
}

export function ChatTranscript({
  chatKey,
  density,
  activePath,
  nodes,
  providers,
  streamByNodeId,
  afterTipStreams,
  showEmpty,
  ariaBusy,
  animate,
  transition,
  messageActionCaptions,
  scrollTargetId,
  onScrollTargetConsumed,
  onSelect,
  onChanged,
  onRegenerate,
  onGenerateUnder,
}: ChatTranscriptProps) {
  const peek = transcriptPeekPx(density)
  const contentPad =
    density === "compact"
      ? "gap-3 p-3 sm:gap-4 sm:p-4"
      : "gap-5 p-5 sm:gap-5 sm:p-8"
  const pathSignature = activePath.map((n) => n.id).join("/")

  const rows = useMemo(
    () =>
      buildTranscriptRows({
        activePath,
        streamByNodeId,
        afterTipStreams,
        showEmpty,
      }),
    [activePath, streamByNodeId, afterTipStreams, showEmpty]
  )
  const mountedIds = useMemo(
    () => mountedTranscriptMessageIds(rows),
    [rows]
  )
  const targetMounted = isScrollTargetMounted(scrollTargetId, mountedIds)

  return (
    <MessageScrollerProvider
      key={chatKey}
      autoScroll
      defaultScrollPosition="last-anchor"
      scrollPreviousItemPeek={peek}
    >
      <MessageScroller className="min-h-0 flex-1">
        <ScrollTargetEffect
          scrollTargetId={scrollTargetId}
          targetMounted={targetMounted}
          onScrollTargetConsumed={onScrollTargetConsumed}
          pathSignature={pathSignature}
        />
        <MessageScrollerViewport data-testid="chat-transcript-viewport">
          <MessageScrollerContent
            aria-busy={ariaBusy}
            className={cn("mx-auto min-w-0 w-full max-w-none", contentPad)}
            style={{
              maxWidth: "var(--message-width, 48rem)",
            }}
          >
            {rows.map((row) => {
              if (row.kind === "empty") {
                return (
                  <MessageScrollerItem
                    key={row.reactKey}
                    messageId={row.messageId}
                    scrollAnchor={row.scrollAnchor}
                  >
                    <motion.div
                      key="empty"
                      initial={animate ? { opacity: 0 } : false}
                      animate={{ opacity: 1 }}
                      transition={transition}
                    >
                      <Empty providers={providers} />
                    </motion.div>
                  </MessageScrollerItem>
                )
              }

              if (row.kind === "after-tip") {
                return (
                  <MessageScrollerItem
                    key={row.reactKey}
                    messageId={row.messageId}
                    scrollAnchor={row.scrollAnchor}
                    className={LIVE_ROW_CLASS}
                  >
                    <StreamingBubble
                      streamId={row.streamId}
                      stream={row.stream}
                      animate={animate}
                      transition={transition}
                    />
                  </MessageScrollerItem>
                )
              }

              return (
                <PathSlot
                  key={row.reactKey}
                  row={row}
                  nodes={nodes}
                  providers={providers}
                  animate={animate}
                  transition={transition}
                  messageActionCaptions={messageActionCaptions}
                  onSelect={onSelect}
                  onChanged={onChanged}
                  onRegenerate={onRegenerate}
                  onGenerateUnder={onGenerateUnder}
                />
              )
            })}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton data-testid="chat-scroll-to-end" />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
