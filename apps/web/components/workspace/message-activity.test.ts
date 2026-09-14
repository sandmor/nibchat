import { describe, expect, it } from "vitest"
import type { Parts, ToolInvocationPart } from "@/lib/types"
import { activitySummary, groupMessageActivity } from "./message-activity"

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
})
