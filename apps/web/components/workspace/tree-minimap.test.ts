import { describe, expect, it } from "vitest"
import type { NodeRow } from "@/lib/types"
import {
  ROOT_ADD_ID,
  addId,
  layoutChatTree,
  treeConnectorPath,
} from "./tree-layout"
import { minimapCardSketch, minimapEdges, minimapViewBox } from "./tree-minimap"

const node = (
  id: string,
  parent_id: string | null,
  role: NodeRow["role"] = "user",
  search_text = id,
  status: NodeRow["status"] = "complete"
): NodeRow => ({
  id,
  chat_id: "chat",
  parent_id,
  selected_child_id: null,
  role,
  parts_json: "[]",
  search_text,
  metadata_json: "{}",
  excluded_from_context: false,
  status,
  created_at: id,
  updated_at: id,
})

describe("minimapEdges", () => {
  it("drops connectors that only exist for plus-button controls", () => {
    const layout = layoutChatTree([
      node("root", null),
      node("child", "root", "assistant"),
    ])
    expect(layout.edges.some((edge) => edge.to === addId("root"))).toBe(true)
    expect(layout.edges.some((edge) => edge.to === addId("child"))).toBe(true)
    expect(minimapEdges(layout)).toEqual([{ from: "root", to: "child" }])
  })
})

describe("minimapViewBox", () => {
  it("crops the plus-button gutter from the map frame", () => {
    const layout = layoutChatTree([node("root", null)])
    const root = layout.rects.get("root")!
    const plus = layout.rects.get(addId("root"))!
    const box = minimapViewBox(layout, 40)
    expect(plus.y + plus.height).toBeGreaterThan(root.y + root.height)
    expect(box.y + box.height).toBeLessThan(plus.y + plus.height)
    expect(box.x).toBe(root.x - 40)
    expect(box.width).toBe(root.width + 80)
    expect(layout.rects.has(ROOT_ADD_ID)).toBe(true)
  })
})

describe("minimapCardSketch", () => {
  it("marks user vs assistant and grows glyph count with text", () => {
    const rect = { x: 0, y: 0, width: 400, height: 220 }
    const short = minimapCardSketch(node("a", null, "user", "Hi"), rect)
    const long = minimapCardSketch(
      node("b", null, "assistant", "word ".repeat(80)),
      rect
    )
    expect(short.user).toBe(true)
    expect(long.user).toBe(false)
    expect(long.glyphs.length).toBeGreaterThan(short.glyphs.length)
    expect(long.glyphs.at(-1)!.width).toBeLessThan(long.glyphs[0]!.width)
    expect(short.rail.x).toBeGreaterThan(rect.x)
    expect(short.glyphs[0]!.x).toBeGreaterThan(short.rail.x + short.rail.width)
  })

  it("flags error cards so the rail can use danger", () => {
    const sketch = minimapCardSketch(
      node("err", null, "assistant", "boom", "error"),
      { x: 0, y: 0, width: 400, height: 180 }
    )
    expect(sketch.error).toBe(true)
    expect(sketch.user).toBe(false)
  })
})

describe("treeConnectorPath", () => {
  it("drops from parent bottom-center to child top-center", () => {
    expect(
      treeConnectorPath(
        { x: 0, y: 0, width: 100, height: 40 },
        { x: 200, y: 120, width: 80, height: 40 }
      )
    ).toBe("M 50 40 C 50 68, 240 92, 240 120")
  })
})
