import { describe, expect, it } from "vitest"
import type { NodeRow } from "@/lib/types"
import {
  afterTipMessageId,
  buildTranscriptRows,
  chatReaderDisposalTarget,
  chatRouteIdentity,
  pathSlotKey,
  transcriptEstimatedRowHeight,
  transcriptMeasurementLayoutKey,
  transcriptPeekPx,
  transcriptRowContentKey,
  transcriptRowIndex,
} from "./chat-transcript-helpers"

function node(
  id: string,
  role: NodeRow["role"] = "user",
  parent_id: string | null = null
): NodeRow {
  return {
    id,
    chat_id: "c1",
    parent_id,
    selected_child_id: null,
    role,
    parts_json: "[]",
    search_text: "",
    metadata_json: "{}",
    excluded_from_context: false,
    status: "complete",
    created_at: "",
    updated_at: "",
  }
}

const noStreams = {
  streamIdByNodeId: new Map<string, string>(),
  afterTipStreams: [] as Array<{ streamId: string; nodeId: string }>,
}

describe("pathSlotKey", () => {
  it("is depth-based, never a node id", () => {
    expect(pathSlotKey(0)).toBe("slot:0")
    expect(pathSlotKey(3)).toBe("slot:3")
    expect(pathSlotKey(0)).not.toBe("u1")
  })
})

describe("transcript row mapping", () => {
  it("uses density-based previous-item peek as scroll padding", () => {
    expect(transcriptPeekPx("compact")).toBe(40)
    expect(transcriptPeekPx("comfortable")).toBe(64)
  })

  it("uses role- and width-aware estimates before a row is measured", () => {
    const user = buildTranscriptRows({
      activePath: [node("u1")],
      ...noStreams,
      showEmpty: false,
    })[0]
    const assistant = buildTranscriptRows({
      activePath: [node("a1", "assistant")],
      ...noStreams,
      showEmpty: false,
    })[0]

    expect(transcriptEstimatedRowHeight(user, 768)).toBe(160)
    expect(transcriptEstimatedRowHeight(assistant, 768)).toBe(384)
    expect(transcriptEstimatedRowHeight(assistant, 480)).toBe(544)
    expect(
      transcriptEstimatedRowHeight(
        { kind: "after-tip", messageId: "pending", streamId: "s1" },
        768
      )
    ).toBe(384)
    expect(transcriptEstimatedRowHeight(undefined, 768)).toBe(256)
  })
})

describe("transcriptMeasurementLayoutKey", () => {
  it("changes only when density or captions change, never path identity", () => {
    expect(transcriptMeasurementLayoutKey("comfortable", false)).toBe(
      "comfortable:plain"
    )
    expect(transcriptMeasurementLayoutKey("comfortable", true)).toBe(
      "comfortable:captions"
    )
    expect(transcriptMeasurementLayoutKey("compact", false)).toBe(
      "compact:plain"
    )
    expect(transcriptMeasurementLayoutKey("comfortable", false)).not.toBe(
      transcriptMeasurementLayoutKey("compact", false)
    )
    expect(transcriptMeasurementLayoutKey("comfortable", false)).not.toBe(
      transcriptMeasurementLayoutKey("comfortable", true)
    )
  })
})

describe("chat route identity", () => {
  it("uses draft until a selected chat id exists", () => {
    expect(chatRouteIdentity(null)).toBe("draft")
    expect(chatRouteIdentity("chat-1")).toBe("chat-1")
  })

  it("does not dispose a draft reader handoff target", () => {
    expect(chatReaderDisposalTarget(null)).toBeNull()
    expect(chatReaderDisposalTarget("draft")).toBeNull()
    expect(chatReaderDisposalTarget("chat-1")).toBe("chat-1")
  })
})

describe("buildTranscriptRows dual identity", () => {
  it("sibling swap keeps slot indexes and changes messageIds", () => {
    const base = [node("u1"), node("a1", "assistant", "u1")]
    const swapped = [node("u1"), node("a2", "assistant", "u1")]

    const before = buildTranscriptRows({
      activePath: base,
      ...noStreams,
      showEmpty: false,
    })
    const after = buildTranscriptRows({
      activePath: swapped,
      ...noStreams,
      showEmpty: false,
    })

    expect(before.map((r) => r.messageId)).toEqual(["u1", "a1"])
    expect(after.map((r) => r.messageId)).toEqual(["u1", "a2"])
    expect(transcriptRowContentKey(before[1]!)).toBe("node:a1")
    expect(transcriptRowContentKey(after[1]!)).toBe("node:a2")

    const tipBefore = before[1]
    const tipAfter = after[1]
    expect(tipBefore?.kind).toBe("path")
    expect(tipAfter?.kind).toBe("path")
    if (tipBefore?.kind === "path" && tipAfter?.kind === "path") {
      expect(tipBefore.slotIndex).toBe(tipAfter.slotIndex)
    }
  })

  it("growing the path appends a new slot without renaming prior keys", () => {
    const short = buildTranscriptRows({
      activePath: [node("u1")],
      ...noStreams,
      showEmpty: false,
    })
    const longer = buildTranscriptRows({
      activePath: [node("u1"), node("a1", "assistant", "u1")],
      ...noStreams,
      showEmpty: false,
    })

    expect(short).toHaveLength(1)
    expect(longer).toHaveLength(2)
    if (short[0]?.kind === "path" && longer[0]?.kind === "path") {
      expect(short[0].slotIndex).toBe(0)
      expect(longer[0].slotIndex).toBe(0)
    }
    expect(longer[1]?.kind === "path" && longer[1].slotIndex).toBe(1)
    expect(longer[0]?.messageId).toBe(short[0]?.messageId)
  })

  it("wires live stream ids onto matching path slots", () => {
    const rows = buildTranscriptRows({
      activePath: [node("u1"), node("a1", "assistant", "u1")],
      streamIdByNodeId: new Map([["a1", "s1"]]),
      afterTipStreams: [],
      showEmpty: false,
    })
    expect(rows[1]?.kind).toBe("path")
    if (rows[1]?.kind === "path") {
      expect(rows[1].liveStreamId).toBe("s1")
      expect(transcriptRowContentKey(rows[1])).toBe("stream:s1")
    }
  })

  it("after-tip rows use stream/node id for messageId", () => {
    const rows = buildTranscriptRows({
      activePath: [node("u1")],
      streamIdByNodeId: new Map(),
      afterTipStreams: [
        { streamId: "s-pending", nodeId: "pending" },
        { streamId: "s-known", nodeId: "asst-new" },
      ],
      showEmpty: false,
    })
    const tips = rows.filter((r) => r.kind === "after-tip")
    expect(tips.map((r) => r.messageId)).toEqual(["s-pending", "asst-new"])
    expect(tips.map((r) => r.streamId)).toEqual(["s-pending", "s-known"])
    expect(tips.map((r) => transcriptRowContentKey(r))).toEqual([
      "stream:s-pending",
      "stream:s-known",
    ])
    expect(afterTipMessageId("s1", { nodeId: "pending" })).toBe("s1")
    expect(afterTipMessageId("s1", { nodeId: "n1" })).toBe("n1")
  })

  it("includes empty row when requested", () => {
    const rows = buildTranscriptRows({
      activePath: [],
      ...noStreams,
      showEmpty: true,
    })
    expect(rows).toEqual([
      {
        kind: "empty",
        messageId: "empty",
      },
    ])
    expect(transcriptRowContentKey(rows[0]!)).toBe("empty")
  })

  it("finds offscreen navigation targets by row index", () => {
    const rows = buildTranscriptRows({
      activePath: [node("u1"), node("a1", "assistant", "u1")],
      ...noStreams,
      showEmpty: false,
    })
    expect(transcriptRowIndex(null, rows)).toBeNull()
    expect(transcriptRowIndex("missing", rows)).toBeNull()
    expect(transcriptRowIndex("u1", rows)).toBe(0)
    expect(transcriptRowIndex("a1", rows)).toBe(1)
  })
})
