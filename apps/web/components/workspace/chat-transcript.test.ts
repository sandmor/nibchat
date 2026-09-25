import { describe, expect, it } from "vitest"
import type { Range } from "@tanstack/react-virtual"
import type { NodeRow } from "@/lib/types"
import {
  afterTipMessageId,
  buildTranscriptRows,
  chatReaderDisposalTarget,
  chatRouteIdentity,
  pathSlotKey,
  transcriptItemKey,
  transcriptGeometryChanged,
  transcriptEstimatedRowHeight,
  transcriptMeasurementLayoutKey,
  transcriptPeekPx,
  transcriptRangeExtractor,
  transcriptRowContentKey,
  transcriptRowIndex,
  transcriptRowMeasurementKey,
  transcriptSiblingsByNodeId,
} from "./chat-transcript-helpers"

function node(
  id: string,
  role: NodeRow["role"] = "user",
  parent_id: string | null = null,
  overrides: Partial<NodeRow> = {}
): NodeRow {
  return {
    id,
    chat_id: "c1",
    parent_id,
    selected_child_id: null,
    sort_key: 0,
    revision: 0,
    role,
    parts_json: "[]",
    search_text: "",
    metadata_json: "{}",
    excluded_from_context: false,
    status: "complete",
    created_at: "",
    updated_at: "",
    ...overrides,
    branch_index: overrides.branch_index ?? null,
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
  it("groups siblings by parent and role, sorted by sort_key", () => {
    const root = node("root")
    const late = node("late", "assistant", "root", { sort_key: 20 })
    const early = node("early", "assistant", "root", { sort_key: 10 })
    const user = node("user", "user", "root", { sort_key: 5 })
    const groups = transcriptSiblingsByNodeId([root, late, user, early])

    expect(groups.get("late")?.map(({ id }) => id)).toEqual(["early", "late"])
    expect(groups.get("early")?.map(({ id }) => id)).toEqual(["early", "late"])
    expect(groups.get("user")?.map(({ id }) => id)).toEqual(["user"])
  })

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

  it("grows conservative estimates for long Markdown and rich parts", () => {
    const markdown = Array.from({ length: 80 }, () => "a wrapped line").join(
      "\n"
    )
    const rich = buildTranscriptRows({
      activePath: [
        node("a-rich", "assistant", null, {
          parts_json: JSON.stringify([
            { type: "text", text: `${markdown}\n\`\`\`ts\ncode\n\`\`\`` },
            {
              type: "tool-invocation",
              toolCallId: "tool-1",
              toolName: "test",
              state: "output-available",
              input: {},
            },
          ]),
        }),
      ],
      ...noStreams,
      showEmpty: false,
    })[0]
    expect(transcriptEstimatedRowHeight(rich, 768)).toBeGreaterThan(1_500)
    expect(transcriptEstimatedRowHeight(rich, 480)).toBeGreaterThanOrEqual(
      transcriptEstimatedRowHeight(rich, 768)
    )
  })

  it("keeps short chats eager and windows only long chats", () => {
    const short: Range = { startIndex: 4, endIndex: 7, overscan: 10, count: 40 }
    expect(transcriptRangeExtractor(short, new Set([0, 39]))).toEqual(
      Array.from({ length: 40 }, (_, index) => index)
    )

    const long: Range = {
      startIndex: 20,
      endIndex: 24,
      overscan: 10,
      count: 41,
    }
    const indexes = transcriptRangeExtractor(long, new Set([0, 40]))
    expect(indexes).toEqual(expect.arrayContaining([0, 40, 20, 24]))
    expect(indexes).not.toHaveLength(41)

    const initialIndexes = transcriptRangeExtractor(long, new Set(), true)
    expect(initialIndexes).toContain(40)
    expect(initialIndexes).not.toContain(0)
    expect(initialIndexes).not.toContain(20)
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
  it("shows a scheduled generation after its user message on the path", () => {
    const user = node("u1", "user", null, {
      schedules: [
        {
          id: "job",
          nextRunAt: "2099-01-01T12:00:00.000Z",
          timeZone: "UTC",
        },
      ],
    })
    const assistant = node("a1", "assistant", "u1")
    const atTip = buildTranscriptRows({
      activePath: [user],
      ...noStreams,
      showEmpty: false,
    })
    const continued = buildTranscriptRows({
      activePath: [user, assistant],
      ...noStreams,
      showEmpty: false,
    })
    const offPath = buildTranscriptRows({
      activePath: [user],
      ...noStreams,
      showEmpty: false,
    })
    expect(atTip.map((row) => row.kind)).toEqual(["path", "scheduled"])
    expect(continued.map((row) => row.kind)).toEqual([
      "path",
      "scheduled",
      "path",
    ])
    expect(atTip[1]?.kind === "scheduled" && atTip[1].verb).toBe("Generates")
    expect(continued[1]?.kind === "scheduled" && continued[1].verb).toBe(
      "Generates"
    )
    expect(offPath[1]?.kind === "scheduled" && offPath[1].verb).toBe(
      "Generates"
    )
    expect(transcriptItemKey(continued, 0)).toBe("slot:0")
    expect(transcriptItemKey(continued, 1)).toBe("schedules:u1")
    expect(transcriptItemKey(continued, 2)).toBe("slot:1")
    const several = node("u1", "user", null, {
      schedules: [
        {
          id: "job-later",
          nextRunAt: "2099-06-01T15:00:00.000Z",
          timeZone: "UTC",
        },
        {
          id: "job-b",
          nextRunAt: "2099-01-01T12:00:00.000Z",
          timeZone: "UTC",
        },
        {
          id: "job",
          nextRunAt: "2099-01-01T12:00:00.000Z",
          timeZone: "UTC",
        },
      ],
    })
    const both = buildTranscriptRows({
      activePath: [several, assistant],
      ...noStreams,
      showEmpty: false,
    })
    expect(both.map((row) => row.kind)).toEqual(["path", "scheduled", "path"])
    expect(transcriptItemKey(both, 1)).toBe("schedules:u1")
    expect(transcriptItemKey(both, 2)).toBe("slot:1")
    expect(
      both[1]?.kind === "scheduled" &&
        both[1].items.map((item) => item.scheduleId)
    ).toEqual(["job", "job-b", "job-later"])
    expect(transcriptRowContentKey(atTip[1]!)).toBe(
      "schedules:u1:job:2099-01-01T12:00:00.000Z"
    )
  })

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

  it("detects durable slot replacement but ignores an unchanged path", () => {
    const before = buildTranscriptRows({
      activePath: [node("u1"), node("a1", "assistant", "u1")],
      ...noStreams,
      showEmpty: false,
    })
    const after = buildTranscriptRows({
      activePath: [node("u1"), node("a2", "assistant", "u1")],
      ...noStreams,
      showEmpty: false,
    })
    expect(transcriptGeometryChanged(before, before)).toBe(false)
    expect(transcriptGeometryChanged(before, after)).toBe(true)
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
      expect(transcriptRowContentKey(rows[1])).toBe("node:a1")
    }
  })

  it("keeps the same content key for live-to-static renderer handoff", () => {
    const activePath = [node("u1"), node("a1", "assistant", "u1")]
    const live = buildTranscriptRows({
      activePath,
      streamIdByNodeId: new Map([["a1", "s1"]]),
      afterTipStreams: [],
      showEmpty: false,
    })
    const complete = buildTranscriptRows({
      activePath,
      ...noStreams,
      showEmpty: false,
    })

    expect(transcriptRowContentKey(live[1]!)).toBe(
      transcriptRowContentKey(complete[1]!)
    )
    expect(transcriptRowMeasurementKey(live[1]!)).not.toBe(
      transcriptRowMeasurementKey(complete[1]!)
    )
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
    expect(transcriptItemKey(rows, 1)).toBe("slot:1")
    expect(transcriptItemKey(rows, 2)).toBe("slot:2")
    const withSchedule = buildTranscriptRows({
      activePath: [
        node("u1", "user", null, {
          schedules: [
            {
              id: "job",
              nextRunAt: "2099-01-01T12:00:00.000Z",
              timeZone: "UTC",
            },
          ],
        }),
        node("a1", "assistant", "u1"),
      ],
      streamIdByNodeId: new Map(),
      afterTipStreams: [{ streamId: "s-known", nodeId: "asst-new" }],
      showEmpty: false,
    })
    expect(transcriptItemKey(withSchedule, 3)).toBe("slot:2")
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
