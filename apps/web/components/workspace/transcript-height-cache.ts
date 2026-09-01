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
    widthBucket: number
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
    const match =
      layout.width == null
        ? [...this.entries.entries()]
            .reverse()
            .find(
              ([, entry]) =>
                entry.messageId === identity.messageId &&
                sameRevision(entry.revision, identity.revision) &&
                entry.density === layout.density &&
                entry.messageActionCaptions === layout.messageActionCaptions &&
                entry.edge === layout.edge
            )
        : (() => {
            const widthBucket = bucketWidth(layout.width)
            const key = entryKey(identity, { ...layout, width: widthBucket })
            const entry = this.entries.get(key)
            return entry ? ([key, entry] as const) : undefined
          })()
    if (!match) return

    // Reads are LRU touches as well: returning to a prior width should retain
    // its exact measurement rather than evicting it behind cold entries.
    const [key, entry] = match
    this.entries.delete(key)
    this.entries.set(key, entry)
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

    const widthBucket = bucketWidth(layout.width)
    const key = entryKey(identity, { ...layout, width: widthBucket })
    const previous = this.entries.get(key)
    this.entries.delete(key)
    this.entries.set(key, {
      ...identity,
      ...omitWidth(layout),
      widthBucket,
      // A bucket can include a slightly narrower viewport. Retain the largest
      // measured result so the first estimate never clips short.
      height: Math.max(previous?.height ?? 0, height),
    })

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest == null) break
      this.entries.delete(oldest)
    }
  }
}

function bucketWidth(width: number) {
  return Math.floor(width / 8) * 8
}

function entryKey(
  identity: TranscriptHeightIdentity,
  layout: Omit<TranscriptHeightLayout, "width"> & { width: number }
) {
  return [
    identity.messageId,
    identity.revision.status,
    identity.revision.updated_at,
    identity.revision.partsLength,
    identity.revision.metadataLength,
    layout.width,
    layout.density,
    layout.messageActionCaptions ? "captions" : "plain",
    layout.edge,
  ].join("|")
}

function omitWidth(
  layout: Omit<TranscriptHeightLayout, "width"> & { width: number }
): Omit<TranscriptHeightLayout, "width"> {
  return {
    density: layout.density,
    messageActionCaptions: layout.messageActionCaptions,
    edge: layout.edge,
  }
}

function widthOrHeightInvalid(value: number) {
  return !Number.isFinite(value) || value <= 0
}

export const transcriptHeightCache = new TranscriptHeightCache()
