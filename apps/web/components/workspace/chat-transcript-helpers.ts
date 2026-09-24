import { defaultRangeExtractor, type Range } from "@tanstack/react-virtual"
import { parseJson } from "@/lib/domain"
import { siblingSort } from "@/lib/sort-key"
import type { NodeRow, Parts } from "@/lib/types"
import { scheduledGenerationVerb } from "./scheduled-generation"

/** Chats at or below this size keep every row mounted for instant scrolling. */
export const TRANSCRIPT_EAGER_ROW_LIMIT = 40
/** Extra rows on each side of the visible window for long transcripts. */
export const TRANSCRIPT_OVERSCAN = 10

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

/**
 * Virtual-row identity. Path depths stay put when a scheduled row is inserted
 * ahead of them, and an after-tip stream keeps the slot it will occupy once
 * it joins the path.
 */
export function transcriptItemKey(
  rows: readonly TranscriptRow[],
  index: number
): string {
  const row = rows[index]
  if (!row) return pathSlotKey(index)
  if (row.kind === "path") return pathSlotKey(row.slotIndex)
  if (row.kind === "scheduled") return `schedules:${row.parentId}`
  if (row.kind === "empty") return "empty"
  let lastSlot = -1
  let afterTipOrdinal = 0
  for (let cursor = 0; cursor < rows.length; cursor++) {
    const candidate = rows[cursor]
    if (!candidate) continue
    if (candidate.kind === "path") lastSlot = candidate.slotIndex
    if (candidate.kind !== "after-tip") continue
    if (cursor === index) return pathSlotKey(lastSlot + 1 + afterTipOrdinal)
    afterTipOrdinal++
  }
  return pathSlotKey(index)
}

/** Build branch groups once per workspace revision instead of once per row. */
export function transcriptSiblingsByNodeId(
  nodes: readonly NodeRow[]
): ReadonlyMap<string, readonly NodeRow[]> {
  const groups = new Map<string, NodeRow[]>()
  for (const node of nodes) {
    const key = `${node.parent_id ?? ""}\u0000${node.role}`
    const group = groups.get(key)
    if (group) group.push(node)
    else groups.set(key, [node])
  }

  const byNodeId = new Map<string, readonly NodeRow[]>()
  for (const group of groups.values()) {
    group.sort(siblingSort)
    for (const node of group) byNodeId.set(node.id, group)
  }
  return byNodeId
}

/** Previous-item peek when jumping to a row (`scrollPaddingStart`). */
export function transcriptPeekPx(density: "comfortable" | "compact"): number {
  return density === "compact" ? 40 : 64
}

/**
 * Inputs that invalidate every virtualizer item size. Durable path rewrites
 * are handled separately through {@link transcriptRowGeometryKey}; this key is
 * for layout settings that affect every row.
 */
export function transcriptMeasurementLayoutKey(
  density: "comfortable" | "compact",
  messageActionCaptions: boolean
): string {
  return `${density}:${messageActionCaptions ? "captions" : "plain"}`
}

/**
 * Keep interactive rows mounted, and avoid windowing entirely for ordinary
 * short conversations without creating a second transcript implementation.
 */
export function transcriptRangeExtractor(
  range: Range,
  retainedIndexes: ReadonlySet<number>,
  initialEnd = false
): number[] {
  if (range.count <= TRANSCRIPT_EAGER_ROW_LIMIT)
    return Array.from({ length: range.count }, (_, index) => index)

  const effectiveRange = initialEnd
    ? {
        ...range,
        startIndex: range.count - 1,
        endIndex: range.count - 1,
      }
    : range
  const indexes = new Set(defaultRangeExtractor(effectiveRange))
  for (const index of retainedIndexes) {
    if (index >= 0 && index < range.count) indexes.add(index)
  }
  return [...indexes].sort((a, b) => a - b)
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

export type ScheduledTranscriptItem = {
  scheduleId: string
  nextRunAt: string
  timeZone: string
  replyCount?: number
}

export type ScheduledTranscriptRow = {
  kind: "scheduled"
  messageId: string
  parentId: string
  /** Chronological, then schedule id. The same instant stays a separate step. */
  items: readonly ScheduledTranscriptItem[]
  verb: "Generates"
}

export type TranscriptRow =
  | EmptyTranscriptRow
  | PathTranscriptRow
  | AfterTipTranscriptRow
  | ScheduledTranscriptRow

/**
 * Conservative first-pass sizes for rows without a width-specific cache.
 * User messages are usually one or two lines; assistant output wraps much
 * taller, especially on narrow canvases.
 */
export function transcriptEstimatedRowHeight(
  row: TranscriptRow | undefined,
  width: number
): number {
  if (row?.kind === "path" && row.node.role === "user") {
    return Math.max(160, transcriptContentEstimate(row.node.parts_json, width))
  }
  if (row?.kind === "scheduled") return row.items.length > 1 ? 128 : 96
  if (
    row?.kind === "after-tip" ||
    (row?.kind === "path" && row.node.role === "assistant")
  ) {
    const minimum = width > 0 && width <= 512 ? 544 : 384
    return row?.kind === "path"
      ? Math.max(minimum, transcriptContentEstimate(row.node.parts_json, width))
      : minimum
  }
  return 256
}

/**
 * A deliberately cheap, upward-biased estimate for unmeasured static rows.
 * Exact geometry still comes from ResizeObserver once a row is mounted.
 */
function transcriptContentEstimate(partsJson: string, width: number): number {
  const widthBucket = Math.floor(Math.max(width, 320) / 8) * 8
  const key = `${widthBucket}:${partsJson}`
  const cached = transcriptEstimateCache.get(key)
  if (cached != null) {
    transcriptEstimateCache.delete(key)
    transcriptEstimateCache.set(key, cached)
    return cached
  }

  const parsed = parseJson<unknown>(partsJson, [])
  const parts = Array.isArray(parsed) ? (parsed as Parts) : []
  const charactersPerLine = Math.max(24, Math.floor((widthBucket - 96) / 8))
  let textLines = 0
  let codeBlocks = 0
  let tableRows = 0
  let reasoningParts = 0
  let richParts = 0

  for (const part of parts) {
    if (part.type === "text") {
      const lines = part.text.split("\n")
      textLines += lines.reduce(
        (total, line) =>
          total + Math.max(1, Math.ceil(line.length / charactersPerLine)),
        0
      )
      codeBlocks += (part.text.match(/^```/gm)?.length ?? 0) / 2
      tableRows += part.text
        .split("\n")
        .filter((line) => /^\s*\|.*\|\s*$/.test(line)).length
    } else if (part.type === "reasoning") {
      reasoningParts += 1
    } else {
      richParts += 1
    }
  }

  const estimate = Math.ceil(
    96 +
      textLines * 24 +
      codeBlocks * 48 +
      tableRows * 36 +
      reasoningParts * 56 +
      richParts * 96
  )
  transcriptEstimateCache.set(key, estimate)
  while (transcriptEstimateCache.size > 4_000) {
    const oldest = transcriptEstimateCache.keys().next().value
    if (oldest == null) break
    transcriptEstimateCache.delete(oldest)
  }
  return estimate
}

const transcriptEstimateCache = new Map<string, number>()

/**
 * Identity for a slot's logical message. Renderer handoff is deliberately not
 * part of this key: Streamdown -> static HTML must replace in one commit rather
 * than crossfading two renderers for the same node.
 */
export function transcriptRowContentKey(row: TranscriptRow): string {
  if (row.kind === "path") {
    return `node:${row.node.id}`
  }
  if (row.kind === "after-tip") return `stream:${row.streamId}`
  if (row.kind === "scheduled")
    return `schedules:${row.parentId}:${row.items
      .map((item) => `${item.scheduleId}:${item.nextRunAt}`)
      .join(",")}`
  return "empty"
}

/**
 * Paint revisions that need a synchronous virtual-row measurement. Unlike the
 * content key, this distinguishes the live and static renderers without
 * causing an enter/exit animation between them.
 */
export function transcriptRowMeasurementKey(row: TranscriptRow): string {
  if (row.kind === "path") {
    return `${transcriptRowContentKey(row)}:${row.liveStreamId ? "live" : "static"}`
  }
  return transcriptRowContentKey(row)
}

/**
 * A durable row change requires rebuilding virtual geometry even when the
 * depth-based item key intentionally keeps the DOM shell alive. Streaming
 * token growth is excluded: ResizeObserver measures that row continuously.
 */
export function transcriptRowGeometryKey(row: TranscriptRow): string {
  if (row.kind === "path") {
    const { node } = row
    return [
      `node:${node.id}`,
      row.liveStreamId ? "live" : "static",
      node.status,
      node.updated_at,
      node.parts_json.length,
      node.metadata_json.length,
    ].join(":")
  }
  return transcriptRowContentKey(row)
}

export function transcriptGeometryChanged(
  previousRows: readonly TranscriptRow[],
  nextRows: readonly TranscriptRow[]
): boolean {
  if (previousRows.length !== nextRows.length) return true
  return previousRows.some(
    (row, index) =>
      transcriptRowGeometryKey(row) !==
      transcriptRowGeometryKey(nextRows[index]!)
  )
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
    const scheduled = node.role === "user" ? (node.schedules ?? []) : []
    if (scheduled.length === 0) return
    rows.push({
      kind: "scheduled",
      messageId: `schedules:${node.id}`,
      parentId: node.id,
      verb: scheduledGenerationVerb(),
      items: [...scheduled]
        .sort((left, right) => {
          if (left.nextRunAt !== right.nextRunAt)
            return left.nextRunAt < right.nextRunAt ? -1 : 1
          return left.id < right.id ? -1 : 1
        })
        .map((item) => ({
          scheduleId: item.id,
          nextRunAt: item.nextRunAt,
          timeZone: item.timeZone,
          replyCount: item.replyCount,
        })),
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
