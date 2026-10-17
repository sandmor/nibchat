import { describe, expect, it } from "vitest"
import {
  composerContextParent,
  groupSiblingBranches,
} from "./conversation-branches"
import type { NodeRow } from "./types"

const node = (
  id: string,
  parent_id: string | null,
  role: NodeRow["role"],
  status: NodeRow["status"],
  sort_key = 0
) => ({ id, parent_id, role, status, sort_key, created_at: "" }) as NodeRow

describe("conversation branches", () => {
  it("uses the existing context for unfinished tips, including roots", () => {
    expect(composerContextParent([])).toBeNull()
    for (const status of ["streaming", "awaiting_input"] as const) {
      expect(composerContextParent([node("a", "u", "assistant", status)])).toBe(
        "u"
      )
      expect(
        composerContextParent([node("a", null, "assistant", status)])
      ).toBeNull()
    }
  })

  it("continues terminal tips of either role", () => {
    for (const status of ["complete", "stopped", "error"] as const)
      for (const role of ["user", "assistant"] as const)
        expect(
          composerContextParent([node("tip", "parent", role, status)])
        ).toBe("tip")
  })

  it("groups mixed roots and children in durable order", () => {
    const first = node("first", null, "assistant", "complete", 1)
    const second = node("second", null, "user", "complete", 2)
    const reply = node("reply", "first", "assistant", "streaming")
    const user = node("user", "first", "user", "complete", 1)
    const groups = groupSiblingBranches([second, user, reply, first])
    expect(groups.get(null)).toEqual([first, second])
    expect(groups.get("first")).toEqual([reply, user])
  })
})
