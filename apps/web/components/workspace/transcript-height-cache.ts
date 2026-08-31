import type { NodeRow } from "@/lib/types"
import type { TranscriptRow } from "./chat-transcript-helpers"

export type TranscriptHeightDensity = "comfortable" | "compact"
export type TranscriptHeightEdge = "only" | "first" | "middle" | "last"

type TranscriptHeightRevision = Pick<NodeRow, "status" | "updated_at"> & {
  partsLength: number
  metadataLength: number
}

export type TranscriptHeightIdentity = {
  messageId: string
  revision: TranscriptHeightRevision
}

export type TranscriptHeightLayout = {
  width: number | null
  density: TranscriptHeightDensity
  messageActionCaptions: boolean
  edge: TranscriptHeightEdge
}

type TranscriptHeightEntry = TranscriptHeightIdentity &
  Omit<TranscriptHeightLayout, "width"> & {
    width: number
    height: number
  }

/**
 * Only finalized message rows have a reusable height. Streams, questionnaires,
 * and the empty state can change independently of their durable message data.
 */
export function transcriptHeightIdentity(
  row: TranscriptRow
): TranscriptHeightIdentity | null {
  if (
    row.kind !== "path" ||
    row.liveStreamId ||
    row.node.status === "streaming" ||
    row.node.status === "awaiting_input"
  ) {
    return null
  }

  return {
    messageId: row.messageId,
    revision: {
      status: row.node.status,
      updated_at: row.node.updated_at,
      partsLength: row.node.parts_json.length,
      metadataLength: row.node.metadata_json.length,
    },
  }
}

export function transcriptHeightEdge(
  index: number,
  count: number
): TranscriptHeightEdge {
  if (count === 1) return "only"
  if (index === 0) return "first"
  if (index === count - 1) return "last"
  return "middle"
}

function sameRevision(
  left: TranscriptHeightRevision,
  right: TranscriptHeightRevision
) {
  return (
    left.status === right.status &&
    left.updated_at === right.updated_at &&
    left.partsLength === right.partsLength &&
    left.metadataLength === right.metadataLength
  )
}

/** A bounded session-local cache, refreshed whenever a message is measured. */
export class TranscriptHeightCache {
  private readonly entries = new Map<string, TranscriptHeightEntry>()

  constructor(private readonly maxEntries = 4_000) {}

  get(
    identity: TranscriptHeightIdentity | null,
    layout: TranscriptHeightLayout
  ): number | undefined {
    if (!identity) return
    const entry = this.entries.get(identity.messageId)
    if (
      !entry ||
      !sameRevision(entry.revision, identity.revision) ||
      (layout.width != null && entry.width !== layout.width) ||
      entry.density !== layout.density ||
      entry.messageActionCaptions !== layout.messageActionCaptions ||
      entry.edge !== layout.edge
    ) {
      return
    }

    return entry.height
  }

  set(
    identity: TranscriptHeightIdentity | null,
    layout: Omit<TranscriptHeightLayout, "width"> & { width: number },
    height: number
  ) {
    if (
      !identity ||
      widthOrHeightInvalid(layout.width) ||
      widthOrHeightInvalid(height)
    )
      return

    this.entries.delete(identity.messageId)
    this.entries.set(identity.messageId, {
      ...identity,
      ...layout,
      height,
    })

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest == null) break
      this.entries.delete(oldest)
    }
  }
}

function widthOrHeightInvalid(value: number) {
  return !Number.isFinite(value) || value <= 0
}

export const transcriptHeightCache = new TranscriptHeightCache()
