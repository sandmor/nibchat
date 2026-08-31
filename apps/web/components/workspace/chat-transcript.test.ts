import { describe, expect, it } from "vitest"
import type { NodeRow } from "@/lib/types"
import {
  afterTipMessageId,
  buildTranscriptRows,
  chatRouteIdentity,
  isScrollTargetMounted,
  mountedTranscriptMessageIds,
  pathSlotKey,
  transcriptPeekPx,
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
  it("uses density-based previous-item peek", () => {
    expect(transcriptPeekPx("compact")).toBe(40)
    expect(transcriptPeekPx("comfortable")).toBe(64)
  })
})

describe("chat route identity", () => {
  it("uses draft until a selected chat id exists", () => {
    expect(chatRouteIdentity(null)).toBe("draft")
    expect(chatRouteIdentity("chat-1")).toBe("chat-1")
  })
})

describe("buildTranscriptRows dual identity", () => {
  it("sibling swap keeps slot reactKeys and changes messageIds", () => {
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

    expect(before.map((r) => r.reactKey)).toEqual(["slot:0", "slot:1"])
    expect(after.map((r) => r.reactKey)).toEqual(["slot:0", "slot:1"])
    expect(before.map((r) => r.messageId)).toEqual(["u1", "a1"])
    expect(after.map((r) => r.messageId)).toEqual(["u1", "a2"])

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

    expect(short.map((r) => r.reactKey)).toEqual(["slot:0"])
    expect(longer.map((r) => r.reactKey)).toEqual(["slot:0", "slot:1"])
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
    expect(tips.map((r) => r.reactKey)).toEqual(["s-pending", "s-known"])
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
        reactKey: "empty",
        messageId: "empty",
      },
    ])
  })

  it("mountedTranscriptMessageIds matches built rows", () => {
    const rows = buildTranscriptRows({
      activePath: [node("u1"), node("a1", "assistant", "u1")],
      streamIdByNodeId: new Map(),
      afterTipStreams: [{ streamId: "s", nodeId: "a-tip" }],
      showEmpty: false,
    })
    expect(mountedTranscriptMessageIds(rows)).toEqual(["u1", "a1", "a-tip"])
  })

  it("only treats mounted ids as ready scroll targets", () => {
    const mounted = ["u1", "a1"]
    expect(isScrollTargetMounted(null, mounted)).toBe(false)
    expect(isScrollTargetMounted("missing", mounted)).toBe(false)
    expect(isScrollTargetMounted("a1", mounted)).toBe(true)
  })
})
