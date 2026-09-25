import { describe, expect, it } from "vitest"
import {
  ancestorPath,
  branchIdForAssistantAfterUserMessage,
  branchIdForContinuation,
  branchIdOf,
  resolveActivePath,
  subtreeNodeIds,
  textFromParts,
} from "@/lib/domain"
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
  sort_key: 0,
  revision: 0,
  branch_index: null,
  role: "user",
  parts_json: "[]",
  search_text: "",
  metadata_json: "{}",
  excluded_from_context: false,
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
  it("uses the earliest sibling when there is no explicit selection", () => {
    const nodes = [
      node("root", null, null),
      { ...node("later", "root", null), sort_key: 2048 },
      { ...node("first", "root", null), sort_key: 1024 },
    ]
    expect(resolveActivePath(nodes, "root").map((item) => item.id)).toEqual([
      "root",
      "first",
    ])
  })
  it("keeps an explicit branch over sibling order", () => {
    const nodes = [
      node("root", null, "later"),
      { ...node("first", "root", null), created_at: "1" },
      { ...node("later", "root", null), created_at: "2" },
    ]
    expect(resolveActivePath(nodes, "root").map((item) => item.id)).toEqual([
      "root",
      "later",
    ])
  })
  it("resolves ancestors without normalizing roles", () => {
    const nodes = [node("root", null, "a"), node("a", "root", null)]
    expect(ancestorPath(nodes, "a").map((n) => n.id)).toEqual(["root", "a"])
  })
  it("fails fast on cyclic ancestor links", () => {
    const nodes = [node("a", "b", null), node("b", "a", null)]
    expect(() => ancestorPath(nodes, "a")).toThrow("cycle")
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
  it("collects a subtree including the root", () => {
    const nodes = [
      node("root", null, null),
      node("a", "root", null),
      node("b", "a", null),
      node("c", "root", null),
    ]
    expect([...subtreeNodeIds(nodes, "a")].sort()).toEqual(["a", "b"])
  })
  it("builds a stable branch id from continued siblings", () => {
    const nodes = [
      { ...node("root", null, "b"), branch_index: 0 },
      node("abandoned", "root", null),
      { ...node("b", "root", "c"), branch_index: 0 },
      { ...node("c", "b", null), branch_index: 0 },
      { ...node("e", "root", "f"), branch_index: 1 },
      node("f", "e", null),
      { ...node("f2", "e", "deeper"), branch_index: 2 },
      node("deeper", "f2", null),
    ]
    expect(branchIdOf(nodes, "c")).toBe("")
    expect(branchIdOf(nodes, "f")).toBe("/1")
    expect(branchIdOf(nodes, "deeper")).toBe("/1/2")
    expect(branchIdOf(nodes, "e")).toBe("")
    expect(branchIdForContinuation(nodes, "e")).toBe("/1")
    expect(branchIdForContinuation(nodes, "abandoned")).toBe("/2")
  })

  it("predicts the assistant id under a new user message", () => {
    const nodes = [
      { ...node("root", null, "kept"), branch_index: 0 },
      { ...node("kept", "root", "reply"), branch_index: 0 },
      node("reply", "kept", null),
    ]
    expect(branchIdForContinuation(nodes, "root")).toBe("")
    expect(branchIdForAssistantAfterUserMessage(nodes, "root")).toBe("/1")
    expect(branchIdForAssistantAfterUserMessage(nodes, null)).toBe("/1")
    expect(branchIdForAssistantAfterUserMessage([], null)).toBe("")
  })
})
