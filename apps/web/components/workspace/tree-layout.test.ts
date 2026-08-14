import { describe, expect, it } from "vitest"
import type { NodeRow } from "@/lib/types"
import {
  ADD_SIZE,
  CARD_WIDTH,
  ROOT_ADD_ID,
  addAnchor,
  addId,
  cardMaxHeight,
  composeLayoutAnchor,
  composeLayoutId,
  isAddId,
  layoutChatTree,
} from "./tree-layout"

const node = (
  id: string,
  parent_id: string | null,
  created_at = id,
  search_text = id
): NodeRow => ({
  id,
  chat_id: "chat",
  parent_id,
  selected_child_id: null,
  role: "user",
  parts_json: "[]",
  search_text,
  metadata_json: "{}",
  excluded_from_context: false,
  status: "complete",
  created_at,
  updated_at: created_at,
})

describe("layoutChatTree", () => {
  it("keeps chronological siblings stable and adds controls after real children", () => {
    const layout = layoutChatTree([
      node("root", null),
      node("a", "root", "a"),
      node("b", "root", "b"),
    ])
    const a = layout.rects.get("a")!,
      b = layout.rects.get("b")!,
      plus = layout.rects.get(addId("root"))!
    expect(a.x).toBeLessThan(b.x)
    expect(b.x).toBeLessThan(plus.x)
    expect(layout.depths.get("root")).toBe(0)
    expect(layout.depths.get("a")).toBe(1)
    expect(layout.depths.get(addId("root"))).toBe(1)
    const sameRow = [a, b, plus].sort((left, right) => left.x - right.x)
    for (let index = 1; index < sameRow.length; index++)
      expect(
        sameRow[index - 1]!.x + sameRow[index - 1]!.width
      ).toBeLessThanOrEqual(sameRow[index]!.x)
    expect(a.x + a.width / 2 + (b.x + b.width / 2)).toBeCloseTo(
      (layout.rects.get("root")!.x + layout.rects.get("root")!.width / 2) * 2
    )
  })

  it("centers a leaf add control below its parent", () => {
    const layout = layoutChatTree([node("root", null)])
    const root = layout.rects.get("root")!
    const plus = layout.rects.get(addId("root"))!
    expect(plus.x + plus.width / 2).toBe(root.x + root.width / 2)
  })

  it("anchors a parent add control to its immediate child group, not descendants", () => {
    const layout = layoutChatTree([
      node("root", null, "1"),
      node("left", "root", "2"),
      node("right", "root", "3"),
      node("deep", "right", "4"),
      node("deeper", "deep", "5"),
    ])
    const right = layout.rects.get("right")!
    const plus = layout.rects.get(addId("root"))!
    expect(plus.x).toBe(right.x + right.width + 48)
  })

  it("does not overlap independent root subtrees", () => {
    const layout = layoutChatTree([
      node("first", null, "1"),
      node("first-child", "first", "2"),
      node("second", null, "3"),
      node("second-child", "second", "4"),
    ])
    const rows = new Map<
      number,
      Array<{ id: string; x: number; width: number }>
    >()
    for (const [id, rect] of layout.rects) {
      const depth = layout.depths.get(id)!
      rows.set(depth, [
        ...(rows.get(depth) ?? []),
        { id, x: rect.x, width: rect.width },
      ])
    }
    for (const row of rows.values()) {
      row.sort((a, b) => a.x - b.x)
      for (let index = 1; index < row.length; index++)
        expect(row[index - 1]!.x + row[index - 1]!.width).toBeLessThanOrEqual(
          row[index]!.x
        )
    }
  })

  it("supports a forest and exposes a final root add control", () => {
    const layout = layoutChatTree([
      node("first", null, "1"),
      node("second", null, "2"),
    ])
    expect(layout.rects.get("first")!.x).toBeLessThan(
      layout.rects.get("second")!.x
    )
    expect(layout.rects.get("second")!.x).toBeLessThan(
      layout.rects.get(ROOT_ADD_ID)!.x
    )
  })

  it("sizes cards from durable text and keeps world bounds non-negative", () => {
    const short = layoutChatTree([
      node("root", null, "1", "hi"),
      node("child", "root", "2", "yo"),
    ])
    const tall = layoutChatTree([
      node("root", null, "1", "word ".repeat(80)),
      node("child", "root", "2", "yo"),
    ])
    expect(
      cardMaxHeight(node("root", null, "1", "word ".repeat(80)))
    ).toBeGreaterThan(cardMaxHeight(node("root", null, "1", "hi")))
    expect(tall.rects.get("child")!.y).toBeGreaterThan(
      short.rects.get("child")!.y
    )
    expect(tall.bounds.x).toBe(0)
    expect(
      Math.min(...[...tall.rects.values()].map((rect) => rect.x))
    ).toBeGreaterThanOrEqual(0)
  })

  it("opens a draft to card width and uses measured height", () => {
    const closed = layoutChatTree([node("root", null)])
    const open = layoutChatTree([node("root", null)], {
      draftAnchors: new Set(["root"]),
    })
    expect(open.rects.get(addId("root"))!.width).toBe(CARD_WIDTH)
    expect(open.rects.get(addId("root"))!.height).toBe(ADD_SIZE)
    expect(closed.rects.get(addId("root"))!.width).toBe(ADD_SIZE)
    const measured = layoutChatTree([node("root", null)], {
      draftAnchors: new Set(["root"]),
      sizes: new Map([[addId("root"), 140]]),
    })
    expect(measured.rects.get(addId("root"))!.height).toBe(140)
  })

  it("treats durable text as a card maximum, not a forced height", () => {
    const n = node("root", null, "1", "word ".repeat(80))
    const max = cardMaxHeight(n)
    const capped = layoutChatTree([n], {
      sizes: new Map([["root", max + 80]]),
    })
    const short = layoutChatTree([n], {
      sizes: new Map([["root", 72]]),
    })
    expect(capped.rects.get("root")!.height).toBe(max)
    expect(short.rects.get("root")!.height).toBe(72)
  })

  it("ignores empty measurements so a card cannot collapse", () => {
    const n = node("root", null, "1", "hi")
    const layout = layoutChatTree([n], { sizes: new Map([["root", 0]]) })
    expect(layout.rects.get("root")!.height).toBe(cardMaxHeight(n))
  })

  it("does not treat a plus-button measurement as an open composer", () => {
    const plus = addId("root")
    const clipped = layoutChatTree([node("root", null)], {
      draftAnchors: new Set(["root"]),
      sizes: new Map([[plus, ADD_SIZE]]),
    })
    expect(clipped.rects.get(plus)!.height).toBe(ADD_SIZE)
    const grown = layoutChatTree([node("root", null)], {
      draftAnchors: new Set(["root"]),
      sizes: new Map([[plus, 140]]),
    })
    expect(grown.rects.get(plus)!.height).toBe(140)
  })

  it("does not treat the root add control as a parent-prefixed add id", () => {
    expect(isAddId(ROOT_ADD_ID)).toBe(true)
    expect(isAddId(addId("abc"))).toBe(true)
    expect(isAddId("abc")).toBe(false)
    expect(addAnchor(ROOT_ADD_ID)).toBeNull()
    expect(addAnchor(addId("abc"))).toBe("abc")
    expect(composeLayoutId(null)).toBe("tree-compose:root")
    expect(composeLayoutId("abc")).toBe("tree-compose:abc")
    expect(composeLayoutAnchor("tree-compose:root")).toBeNull()
    expect(composeLayoutAnchor("tree-compose:abc")).toBe("abc")
  })
})
