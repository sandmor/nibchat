import { describe, expect, it } from "vitest"
import { collectPages } from "@/lib/generation-streams/pages"

describe("collectPages", () => {
  it("drains every page until the backend returns an empty range", async () => {
    const pages = [["a", "b"], ["c"], ["d", "e"], []]
    let calls = 0
    const items = await collectPages(async (after) => {
      expect(after).toBe(calls === 0 ? null : pages[calls - 1]!.at(-1))
      const page = pages[calls] ?? []
      calls += 1
      return page
    }, (item) => item)
    expect(items).toEqual(["a", "b", "c", "d", "e"])
    expect(calls).toBe(4)
  })

  it("does not stop at a full page; the next empty range is the terminator", async () => {
    const pages: string[][] = [["1", "2"], []]
    const items = await collectPages(async (after) => {
      if (after == null) return pages[0]!
      return pages[1]!
    }, (item) => item)
    expect(items).toEqual(["1", "2"])
  })
})
