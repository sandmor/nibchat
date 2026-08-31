import type { NodeRow } from "@/lib/types"

/**
 * Dual identity for path rows (do not collapse these):
 * - slot index / {@link pathSlotKey} = virtualizer item key (depth). Stable
 *   across sibling branch switches so the row shell does not remount;
 *   SlotCrossfade owns content motion.
 * - messageId = node (or stream) id for virtual scroll / jump lookup.
 *
 * Never use node id as the virtualizer item key for path rows.
 * Live rows carry a stream id only — token text stays in the stream buffer.
 */

export function pathSlotKey(slotIndex: number): string {
  return `slot:${slotIndex}`
}

/** Previous-item peek when jumping to a row (`scrollPaddingStart`). */
export function transcriptPeekPx(density: "comfortable" | "compact"): number {
  return density === "compact" ? 40 : 64
}

/**
 * Inputs that invalidate every virtualizer item size. Path identity is not one
 * of them: slot shells remeasure on {@link transcriptRowContentKey}, and wiping
 * the cache on a rewrite jumps a scrolled-away viewport.
 */
export function transcriptMeasurementLayoutKey(
  density: "comfortable" | "compact",
  messageActionCaptions: boolean
): string {
  return `${density}:${messageActionCaptions ? "captions" : "plain"}`
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

export type EmptyTranscriptRow = {
  kind: "empty"
  messageId: "empty"
}

export type PathTranscriptRow = {
  kind: "path"
  slotIndex: number
  messageId: string
  node: NodeRow
  /** Live generation for this node, if any. Payload is read in StreamingBubble. */
  liveStreamId: string | null
}

export type AfterTipTranscriptRow = {
  kind: "after-tip"
  messageId: string
  streamId: string
}

export type TranscriptRow =
  | EmptyTranscriptRow
  | PathTranscriptRow
  | AfterTipTranscriptRow

/**
 * Conservative first-pass sizes for rows without a width-specific cache.
 * User messages are usually one or two lines; assistant output wraps much
 * taller, especially on narrow canvases.
 */
export function transcriptEstimatedRowHeight(
  row: TranscriptRow | undefined,
  width: number
): number {
  if (row?.kind === "path" && row.node.role === "user") return 160
  if (
    row?.kind === "after-tip" ||
    (row?.kind === "path" && row.node.role === "assistant")
  ) {
    return width > 0 && width <= 512 ? 544 : 384
  }
  return 256
}

/** Identity for a slot's present body. Changes on sibling rewrite, not depth. */
export function transcriptRowContentKey(row: TranscriptRow): string {
  if (row.kind === "path") {
    return row.liveStreamId
      ? `stream:${row.liveStreamId}`
      : `node:${row.node.id}`
  }
  if (row.kind === "after-tip") return `stream:${row.streamId}`
  return "empty"
}

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
      messageId: "empty",
    })
  }

  input.activePath.forEach((node, slotIndex) => {
    rows.push({
      kind: "path",
      slotIndex,
      messageId: node.id,
      node,
      liveStreamId: input.streamIdByNodeId.get(node.id) ?? null,
    })
  })

  for (const stream of input.afterTipStreams) {
    rows.push({
      kind: "after-tip",
      messageId: afterTipMessageId(stream.streamId, stream),
      streamId: stream.streamId,
    })
  }

  return rows
}

/** Index for a durable node/stream id, regardless of whether its row is mounted. */
export function transcriptRowIndex(
  messageId: string | null,
  rows: readonly TranscriptRow[]
): number | null {
  if (!messageId) return null
  const index = rows.findIndex((row) => row.messageId === messageId)
  return index === -1 ? null : index
}
