import { describe, expect, it } from "vitest"
import { ancestorPath, resolveActivePath, textFromParts } from "@/lib/domain"
import type { NodeRow } from "@/lib/types"

const node = (
  id: string,
  parent_id: string | null,
  selected_child_id: string | null
): NodeRow => ({
  id,
  chat_id: "chat",
  parent_id,
  selected_child_id,
  role: "user",
  parts_json: "[]",
  search_text: "",
  metadata_json: "{}",
  status: "complete",
  created_at: "",
  updated_at: "",
})
describe("tree navigation", () => {
  it("follows downstream selections only", () => {
    const nodes = [
      node("root", null, "a"),
      node("a", "root", "a1"),
      node("b", "root", null),
      node("a1", "a", null),
    ]
    expect(resolveActivePath(nodes, "root").map((n) => n.id)).toEqual([
      "root",
      "a",
      "a1",
    ])
  })
  it("resolves ancestors without normalizing roles", () => {
    const nodes = [node("root", null, "a"), node("a", "root", null)]
    expect(ancestorPath(nodes, "a").map((n) => n.id)).toEqual(["root", "a"])
  })
  it("does not put reasoning into searchable text", () =>
    expect(
      textFromParts([
        { type: "reasoning", text: "hidden" },
        { type: "text", text: "visible" },
      ])
    ).toBe("visible"))
  it("resolves a 2,000-node selected path without recursion", () => {
    const nodes = Array.from({ length: 2000 }, (_, index) =>
      node(
        String(index),
        index === 0 ? null : String(index - 1),
        index === 1999 ? null : String(index + 1)
      )
    )
    const started = performance.now()
    const path = resolveActivePath(nodes, "0")
    expect(path).toHaveLength(2000)
    expect(performance.now() - started).toBeLessThan(250)
  })
})
