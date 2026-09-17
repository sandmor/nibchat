import { describe, expect, it } from "vitest"
import type { Parts, ToolInvocationPart } from "@/lib/types"
import {
  activitySummary,
  groupMessageActivity,
  isActivityGroupBusy,
  shouldAutoCollapseActivity,
} from "./message-activity"

const tool = (
  toolName: string,
  state: ToolInvocationPart["state"] = "output-available"
): ToolInvocationPart => ({
  type: "tool-invocation",
  toolCallId: toolName,
  toolName,
  state,
  input: {},
})

describe("message activity", () => {
  it("groups consecutive activity without moving intervening text", () => {
    const parts: Parts = [
      { type: "reasoning", text: "Plan" },
      tool("search"),
      { type: "text", text: "Here is what I found." },
      tool("read_file"),
      { type: "reasoning", text: "Review" },
      { type: "text", text: "Answer" },
    ]
    const groups = groupMessageActivity(parts)
    expect(groups.map((group) => group.parts.length)).toEqual([2, 1, 2, 1])
    expect(groups.flatMap((group) => group.parts)).toEqual(parts)
  })

  it("keeps questions and errors outside collapsed activity", () => {
    const groups = groupMessageActivity([
      tool("search"),
      tool("question", "input-available"),
      tool("read_file", "output-error"),
      tool("search"),
    ])
    expect(groups.map((group) => group.activity)).toEqual([
      true,
      false,
      false,
      true,
    ])
  })

  it("summarizes reasoning and repeated tool names", () => {
    expect(
      activitySummary([
        { type: "reasoning", text: "Plan" },
        tool("search"),
        tool("search"),
        tool("read_file"),
      ])
    ).toBe("Reasoning · search × 2 · read file")
  })

  it("treats in-flight tools as busy and completed tools as idle", () => {
    expect(isActivityGroupBusy([{ type: "reasoning", text: "Plan" }])).toBe(
      false
    )
    expect(isActivityGroupBusy([tool("search")])).toBe(false)
    expect(isActivityGroupBusy([tool("search", "input-streaming")])).toBe(true)
    expect(isActivityGroupBusy([tool("search", "input-available")])).toBe(true)
  })

  it("collapses idle activity after the stream moves on unless the reader pinned it", () => {
    const cases: Array<{
      name: string
      input: Parameters<typeof shouldAutoCollapseActivity>[0]
      collapse: boolean
    }> = [
      {
        name: "historical",
        input: {
          streaming: false,
          busy: false,
          hasSuccessor: false,
          userToggled: false,
          atLiveEdge: true,
        },
        collapse: true,
      },
      {
        name: "live last group",
        input: {
          streaming: true,
          busy: false,
          hasSuccessor: false,
          userToggled: false,
          atLiveEdge: true,
        },
        collapse: false,
      },
      {
        name: "live busy last group",
        input: {
          streaming: true,
          busy: true,
          hasSuccessor: false,
          userToggled: false,
          atLiveEdge: true,
        },
        collapse: false,
      },
      {
        name: "successor at live edge",
        input: {
          streaming: true,
          busy: false,
          hasSuccessor: true,
          userToggled: false,
          atLiveEdge: true,
        },
        collapse: true,
      },
      {
        name: "successor away from live edge",
        input: {
          streaming: true,
          busy: false,
          hasSuccessor: true,
          userToggled: false,
          atLiveEdge: false,
        },
        collapse: false,
      },
      {
        name: "busy with successor",
        input: {
          streaming: true,
          busy: true,
          hasSuccessor: true,
          userToggled: false,
          atLiveEdge: true,
        },
        collapse: false,
      },
      {
        name: "user pinned open after successor",
        input: {
          streaming: true,
          busy: false,
          hasSuccessor: true,
          userToggled: true,
          atLiveEdge: true,
        },
        collapse: false,
      },
      {
        name: "user pinned open after stream end",
        input: {
          streaming: false,
          busy: false,
          hasSuccessor: true,
          userToggled: true,
          atLiveEdge: true,
        },
        collapse: false,
      },
      {
        name: "stream end away from live edge",
        input: {
          streaming: false,
          busy: false,
          hasSuccessor: false,
          userToggled: false,
          atLiveEdge: false,
        },
        collapse: true,
      },
    ]
    for (const { name, input, collapse } of cases) {
      expect(shouldAutoCollapseActivity(input), name).toBe(collapse)
    }
  })
})
