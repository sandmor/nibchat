import { describe, expect, it } from "vitest"
import {
  rebalanceSortKeys,
  siblingSort,
  SORT_KEY_STEP,
  sortKeyAfter,
  sortKeyBetween,
} from "@/lib/sort-key"

describe("sort keys", () => {
  it("appends after the current maximum with a stable gap", () => {
    expect(sortKeyAfter(undefined)).toBe(SORT_KEY_STEP)
    expect(sortKeyAfter(SORT_KEY_STEP)).toBe(SORT_KEY_STEP * 2)
  })

  it("places a rank strictly between neighbors", () => {
    expect(sortKeyBetween(1024, 2048)).toBe(1536)
    expect(sortKeyBetween(null, 1024)).toBe(0)
  })

  it("signals when floats cannot represent a new rank", () => {
    expect(sortKeyBetween(1, 1)).toBeNull()
    const tight = 1 + Number.EPSILON / 2
    expect(sortKeyBetween(1, tight) == null || sortKeyBetween(1, tight) === 1).toBe(
      true
    )
  })

  it("rebalances a group onto stepped ranks", () => {
    expect([...rebalanceSortKeys(["a", "b", "c"]).values()]).toEqual([
      1024, 2048, 3072,
    ])
  })

  it("orders equal keys by created_at then id", () => {
    const left = { id: "b", created_at: "2024-01-01T00:00:00.000Z", sort_key: 1 }
    const right = { id: "a", created_at: "2024-01-01T00:00:00.000Z", sort_key: 1 }
    expect([left, right].sort(siblingSort).map((row) => row.id)).toEqual([
      "a",
      "b",
    ])
  })
})
