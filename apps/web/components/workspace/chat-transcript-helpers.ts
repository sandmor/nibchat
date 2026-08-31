import type { NodeRow } from "@/lib/types"

/**
 * Dual identity for path rows (do not collapse these):
 * - reactKey  = path slot (depth). Stable across sibling branch switches so the
 *   MessageScroller item shell does not remount; SlotCrossfade owns content motion.
 * - messageId = node (or stream) id for MessageScroller scroll / jump.
 *
 * Never use node id as the React list key for path rows.
 * Live rows carry a stream id only — token text stays in the stream buffer.
 */

export function pathSlotKey(slotIndex: number): string {
  return `slot:${slotIndex}`
}

export function transcriptPeekPx(density: "comfortable" | "compact"): number {
  return density === "compact" ? 40 : 64
}

/** Centered linear column width. */
export const TRANSCRIPT_COLUMN_MAX_WIDTH = "var(--message-width, 48rem)"

/**
 * Jump-to-end sits in the right gutter, just outside the column.
 * Floor keeps it on-pane (and clear of the scrollbar) when there is no gutter.
 */
export const TRANSCRIPT_SCROLL_TO_END_INSET = `max(1.5rem, env(safe-area-inset-right, 0px), calc((100% - ${TRANSCRIPT_COLUMN_MAX_WIDTH}) / 2 - 2.75rem))`

/**
 * Route-level chat identity for MPA soft-nav (not pending draft create ids).
 * Soft-nav reuses ChatView between /chat/[id] pages; state must reset here.
 */
export function chatRouteIdentity(selectedChatId: string | null): string {
  return selectedChatId ?? "draft"
}

/**
 * Reader cleanup follows the route being left, never a chat created while the
 * draft route hands off to /chat/[id]. That pending chat is the destination.
 */
export function chatReaderDisposalTarget(
  boundChatIdentity: string | null
): string | null {
  return boundChatIdentity && boundChatIdentity !== "draft"
    ? boundChatIdentity
    : null
}

/**
 * Disable content-visibility on height-churning stream rows so measure/follow
 * stay stable while tokens and markdown reflow.
 */
export const LIVE_ROW_CLASS =
  "[content-visibility:visible] [contain-intrinsic-size:none]"

export type EmptyTranscriptRow = {
  kind: "empty"
  reactKey: "empty"
  messageId: "empty"
}

export type PathTranscriptRow = {
  kind: "path"
  /** React list key — depth slot, not node id */
  reactKey: string
  slotIndex: number
  messageId: string
  node: NodeRow
  /** Live generation for this node, if any. Payload is read in StreamingBubble. */
  liveStreamId: string | null
}

export type AfterTipTranscriptRow = {
  kind: "after-tip"
  reactKey: string
  messageId: string
  streamId: string
}

export type TranscriptRow =
  | EmptyTranscriptRow
  | PathTranscriptRow
  | AfterTipTranscriptRow

export function afterTipMessageId(
  streamId: string,
  stream: { nodeId: string }
): string {
  return stream.nodeId !== "pending" ? stream.nodeId : streamId
}

export function buildTranscriptRows(input: {
  activePath: NodeRow[]
  streamIdByNodeId: ReadonlyMap<string, string>
  afterTipStreams: Array<{ streamId: string; nodeId: string }>
  showEmpty: boolean
}): TranscriptRow[] {
  const rows: TranscriptRow[] = []

  if (input.showEmpty) {
    rows.push({
      kind: "empty",
      reactKey: "empty",
      messageId: "empty",
    })
  }

  input.activePath.forEach((node, slotIndex) => {
    rows.push({
      kind: "path",
      reactKey: pathSlotKey(slotIndex),
      slotIndex,
      messageId: node.id,
      node,
      liveStreamId: input.streamIdByNodeId.get(node.id) ?? null,
    })
  })

  for (const stream of input.afterTipStreams) {
    rows.push({
      kind: "after-tip",
      reactKey: stream.streamId,
      messageId: afterTipMessageId(stream.streamId, stream),
      streamId: stream.streamId,
    })
  }

  return rows
}

/** messageIds currently rendered — for scroll-target mount gating. */
export function mountedTranscriptMessageIds(rows: TranscriptRow[]): string[] {
  return rows.map((row) => row.messageId)
}

export function isScrollTargetMounted(
  scrollTargetId: string | null,
  mountedIds: readonly string[]
): boolean {
  if (!scrollTargetId) return false
  return mountedIds.includes(scrollTargetId)
}
