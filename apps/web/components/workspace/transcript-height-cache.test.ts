import { describe, expect, it } from "vitest"
import type { NodeRow } from "@/lib/types"
import type { TranscriptRow } from "./chat-transcript-helpers"
import {
  TranscriptHeightCache,
  transcriptHeightEdge,
  transcriptHeightIdentity,
  type TranscriptHeightLayout,
} from "./transcript-height-cache"

function row(
  id: string,
  overrides: Partial<NodeRow> = {}
): Extract<TranscriptRow, { kind: "path" }> {
  return {
    kind: "path",
    slotIndex: 0,
    messageId: id,
    liveStreamId: null,
    node: {
      id,
      chat_id: "chat-1",
      parent_id: null,
      selected_child_id: null,
      role: "assistant",
      parts_json: '[{"type":"text","text":"hello"}]',
      search_text: "hello",
      metadata_json: "{}",
      excluded_from_context: false,
      status: "complete",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      ...overrides,
    },
  }
}

const layout: TranscriptHeightLayout = {
  width: 768,
  density: "comfortable",
  messageActionCaptions: false,
  edge: "middle",
}

describe("TranscriptHeightCache", () => {
  it("reuses a finalized message height for the same content and layout", () => {
    const cache = new TranscriptHeightCache()
    const identity = transcriptHeightIdentity(row("a1"))

    cache.set(identity, { ...layout, width: 768 }, 432)

    expect(cache.get(identity, layout)).toBe(432)
    expect(cache.get(identity, { ...layout, width: null })).toBe(432)
  })

  it("rejects heights from changed content or layout", () => {
    const cache = new TranscriptHeightCache()
    const identity = transcriptHeightIdentity(row("a1"))
    cache.set(identity, { ...layout, width: 768 }, 432)

    expect(
      cache.get(
        transcriptHeightIdentity(
          row("a1", {
            parts_json: '[{"type":"text","text":"changed"}]',
            updated_at: "2026-01-02T00:00:00.000Z",
          })
        ),
        layout
      )
    ).toBeUndefined()
    expect(cache.get(identity, { ...layout, width: 640 })).toBeUndefined()
    expect(
      cache.get(identity, { ...layout, density: "compact" })
    ).toBeUndefined()
    expect(cache.get(identity, { ...layout, edge: "last" })).toBeUndefined()
  })

  it("does not cache volatile transcript rows", () => {
    expect(
      transcriptHeightIdentity(row("streaming", { status: "streaming" }))
    ).toBeNull()
    expect(
      transcriptHeightIdentity(row("question", { status: "awaiting_input" }))
    ).toBeNull()
    expect(
      transcriptHeightIdentity({
        kind: "after-tip",
        messageId: "pending",
        streamId: "stream-1",
      })
    ).toBeNull()
  })

  it("distinguishes padding at transcript edges", () => {
    expect(transcriptHeightEdge(0, 1)).toBe("only")
    expect(transcriptHeightEdge(0, 3)).toBe("first")
    expect(transcriptHeightEdge(1, 3)).toBe("middle")
    expect(transcriptHeightEdge(2, 3)).toBe("last")
  })

  it("evicts the least-recently-measured message", () => {
    const cache = new TranscriptHeightCache(2)
    const a = transcriptHeightIdentity(row("a"))
    const b = transcriptHeightIdentity(row("b"))
    const c = transcriptHeightIdentity(row("c"))
    cache.set(a, { ...layout, width: 768 }, 100)
    cache.set(b, { ...layout, width: 768 }, 200)
    cache.set(a, { ...layout, width: 768 }, 100)

    cache.set(c, { ...layout, width: 768 }, 300)

    expect(cache.get(a, layout)).toBe(100)
    expect(cache.get(b, layout)).toBeUndefined()
    expect(cache.get(c, layout)).toBe(300)
  })
})
