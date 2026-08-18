import { describe, expect, it } from "vitest"
import {
  buildHits,
  findOccurrences,
  distinctOffPathMessageCount,
  distinctPathMessageCount,
  firstHitOnNode,
  firstOffPathHit,
  occurrenceIndexInNode,
  occurrenceKey,
  needsPathConfirm,
  nextFindRevealPending,
  normalizeQuery,
  pathHits,
  pinnedOccurrenceIndex,
  planPathSwitch,
  snippet,
  stepIndex,
  type SearchNode,
} from "./conversation-search"

const node = (id: string, findText: string): SearchNode => ({ id, findText })

describe("normalizeQuery / findOccurrences", () => {
  it("trims and yields no hits for an empty query", () => {
    expect(normalizeQuery("  foo  ")).toBe("foo")
    expect(findOccurrences("hello", "   ")).toEqual([])
    expect(findOccurrences("hello", "")).toEqual([])
  })

  it("finds case-insensitive non-overlapping substrings", () => {
    expect(findOccurrences("Foo bar FOO", "foo")).toEqual([0, 8])
    expect(findOccurrences("aaaa", "aa")).toEqual([0, 2])
    expect(findOccurrences("Hello World", "WORLD")).toEqual([6])
  })

  it("does not treat query characters as a regex", () => {
    expect(findOccurrences("cost is $5", "$5")).toEqual([8])
    expect(findOccurrences("a+b", "+")).toEqual([1])
  })
})

describe("buildHits path-first then layout", () => {
  const nodes = [
    node("root", "alpha on root"),
    node("on-path", "alpha on path"),
    node("off-a", "alpha off first"),
    node("off-b", "alpha off later"),
  ]
  const pathIds = ["root", "on-path"]
  const layoutIds = ["root", "on-path", "off-b", "off-a"]

  it("lists path occurrences before off-path hits in layout order", () => {
    const hits = buildHits(nodes, "alpha", { pathIds, layoutIds })
    expect(hits.map((hit) => hit.nodeId)).toEqual([
      "root",
      "on-path",
      "off-b",
      "off-a",
    ])
    expect(hits.map((hit) => hit.onPath)).toEqual([true, true, false, false])
  })

  it("keeps multiple occurrences on one node together", () => {
    const repeats = [node("n", "foo then FOO")]
    const hits = buildHits(repeats, "foo", {
      pathIds: ["n"],
      layoutIds: ["n"],
    })
    expect(hits).toEqual([
      { nodeId: "n", start: 0, onPath: true },
      { nodeId: "n", start: 9, onPath: true },
    ])
  })
})

describe("stepIndex wraparound", () => {
  it("wraps forward and backward", () => {
    expect(stepIndex(0, 1, 3)).toBe(1)
    expect(stepIndex(2, 1, 3)).toBe(0)
    expect(stepIndex(0, -1, 3)).toBe(2)
    expect(stepIndex(0, 1, 0)).toBe(0)
  })
})

describe("nextFindRevealPending", () => {
  it("clears a leftover pending reveal when locateKey drops to 0", () => {
    expect(nextFindRevealPending(3, 0, 3)).toBe(0)
    expect(nextFindRevealPending(0, 4, 0)).toBe(4)
    expect(nextFindRevealPending(4, 4, 4)).toBe(4)
  })
})

describe("path confirm vs locate", () => {
  it("needs confirm only when the node is off the active path", () => {
    expect(needsPathConfirm("on", ["on", "tip"])).toBe(false)
    expect(needsPathConfirm("off", ["on", "tip"])).toBe(true)
    expect(needsPathConfirm("off", new Set(["on"]))).toBe(true)
  })

  it("plans an immediate locate on-path and a confirm pin off-path", () => {
    const hits = buildHits(
      [node("on", "hello"), node("off", "hello")],
      "hello",
      { pathIds: ["on"], layoutIds: ["on", "off"] }
    )
    expect(planPathSwitch("on", hits, ["on"])).toEqual({
      confirm: false,
      nodeId: "on",
      pin: occurrenceKey(hits[0]!),
      index: 0,
    })
    expect(planPathSwitch("off", hits, ["on"])).toEqual({
      confirm: true,
      nodeId: "off",
      pin: occurrenceKey(hits[1]!),
    })
  })

  it("lists path hits separately from off-path hits", () => {
    const hits = buildHits(
      [node("on", "hello"), node("off", "hello")],
      "hello",
      { pathIds: ["on"], layoutIds: ["on", "off"] }
    )
    expect(pathHits(hits).map((hit) => hit.nodeId)).toEqual(["on"])
    expect(firstOffPathHit(hits)?.nodeId).toBe("off")
    expect(distinctPathMessageCount(hits)).toBe(1)
    expect(distinctOffPathMessageCount(hits)).toBe(1)
  })

  it("counts distinct off-path messages, not occurrences", () => {
    const hits = buildHits([node("on", "x x"), node("off", "x x x")], "x", {
      pathIds: ["on"],
      layoutIds: ["on", "off"],
    })
    expect(distinctPathMessageCount(hits)).toBe(1)
    expect(distinctOffPathMessageCount(hits)).toBe(1)
  })

  it("keeps the same occurrence when path order changes", () => {
    const nodes = [
      node("root", "alpha"),
      node("a", "alpha"),
      node("b", "alpha"),
    ]
    const before = buildHits(nodes, "alpha", {
      pathIds: ["root", "a"],
      layoutIds: ["root", "a", "b"],
    })
    expect(before.map((hit) => hit.nodeId)).toEqual(["root", "a", "b"])
    const key = occurrenceKey(before[2]!)
    const after = buildHits(nodes, "alpha", {
      pathIds: ["root", "b"],
      layoutIds: ["root", "a", "b"],
    })
    expect(after.map((hit) => hit.nodeId)).toEqual(["root", "b", "a"])
    expect(pinnedOccurrenceIndex(after, key, 2)).toBe(1)
    expect(pinnedOccurrenceIndex(after, null, 9)).toBe(2)
    expect(pinnedOccurrenceIndex([], key, 4)).toBe(0)
  })

  it("firstHitOnNode returns the first occurrence index", () => {
    const hits = buildHits([node("n", "x x x")], "x", {
      pathIds: ["n"],
      layoutIds: ["n"],
    })
    expect(firstHitOnNode(hits, "n")).toEqual({ hit: hits[0], index: 0 })
    expect(firstHitOnNode(hits, "missing")).toBeNull()
  })

  it("maps a list index to the occurrence on that node", () => {
    const hits = buildHits([node("a", "x x"), node("b", "x")], "x", {
      pathIds: ["a", "b"],
      layoutIds: ["a", "b"],
    })
    expect(occurrenceIndexInNode(hits, 0)).toBe(0)
    expect(occurrenceIndexInNode(hits, 1)).toBe(1)
    expect(occurrenceIndexInNode(hits, 2)).toBe(0)
  })
})

describe("snippet", () => {
  it("clips around the match", () => {
    const text = "prefix unique-token suffix"
    const start = text.indexOf("unique-token")
    expect(snippet(text, start, "unique-token", 4)).toContain("unique-token")
    expect(snippet(text, start, "unique-token", 4)).toMatch(/^…/)
  })
})
