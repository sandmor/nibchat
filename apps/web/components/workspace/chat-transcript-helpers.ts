import type { NodeRow } from "@/lib/types"
import type { ActiveStream } from "@/lib/stream-store"

/**
 * Dual identity for path rows (do not collapse these):
 * - reactKey  = path slot (depth). Stable across sibling branch switches so
 *   Message's article shell can AnimatePresence-crossfade node bodies.
 * - messageId = node (or stream) id for MessageScroller scroll / jump.
 *
 * Never use node id as the React list key for path rows.
 */

export function pathSlotKey(slotIndex: number): string {
  return `slot:${slotIndex}`
}

/** Transcript row boundary rules — messageId + scrollAnchor for MessageScroller. */
export function isScrollAnchorRole(role: NodeRow["role"]): boolean {
  return role === "user"
}

export function transcriptPeekPx(density: "comfortable" | "compact"): number {
  return density === "compact" ? 40 : 64
}

/**
 * Route-level chat identity for MPA soft-nav (not pending draft create ids).
 * Soft-nav reuses ChatView between /chat/[id] pages; state must reset here.
 */
export function chatRouteIdentity(selectedChatId: string | null): string {
  return selectedChatId ?? "draft"
}

/**
 * Disable content-visibility on height-churning stream rows so measure/follow
 * stay stable while tokens and markdown reflow.
 */
export const LIVE_ROW_CLASS =
  "[content-visibility:visible] [contain-intrinsic-size:none]"

export type LiveStreamEntry = [streamId: string, stream: ActiveStream]

export type EmptyTranscriptRow = {
  kind: "empty"
  reactKey: "empty"
  messageId: "empty"
  scrollAnchor: false
}

export type PathTranscriptRow = {
  kind: "path"
  /** React list key — depth slot, not node id */
  reactKey: string
  slotIndex: number
  messageId: string
  scrollAnchor: boolean
  node: NodeRow
  live: LiveStreamEntry | null
}

export type AfterTipTranscriptRow = {
  kind: "after-tip"
  reactKey: string
  messageId: string
  scrollAnchor: false
  streamId: string
  stream: ActiveStream
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
  streamByNodeId: Map<string, LiveStreamEntry>
  afterTipStreams: LiveStreamEntry[]
  showEmpty: boolean
}): TranscriptRow[] {
  const rows: TranscriptRow[] = []

  if (input.showEmpty) {
    rows.push({
      kind: "empty",
      reactKey: "empty",
      messageId: "empty",
      scrollAnchor: false,
    })
  }

  input.activePath.forEach((node, slotIndex) => {
    rows.push({
      kind: "path",
      reactKey: pathSlotKey(slotIndex),
      slotIndex,
      messageId: node.id,
      scrollAnchor: isScrollAnchorRole(node.role),
      node,
      live: input.streamByNodeId.get(node.id) ?? null,
    })
  })

  for (const [streamId, stream] of input.afterTipStreams) {
    rows.push({
      kind: "after-tip",
      reactKey: streamId,
      messageId: afterTipMessageId(streamId, stream),
      scrollAnchor: false,
      streamId,
      stream,
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
