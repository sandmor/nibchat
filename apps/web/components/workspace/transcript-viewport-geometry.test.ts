import { describe, expect, it } from "vitest"
import { patchTranscriptLayoutRows } from "./transcript-viewport-geometry"

const rows = [
  { key: "slot:0", start: 0, size: 100 },
  { key: "slot:1", start: 100, size: 200 },
  { key: "slot:2", start: 300, size: 50 },
]

describe("patchTranscriptLayoutRows", () => {
  it("reuses the row list when every box is unchanged", () => {
    const flat = Float64Array.of(0, 100, 100, 200, 300, 50)
    expect(patchTranscriptLayoutRows(rows, flat, rows.length)).toBe(rows)
  })

  it("clones only the resized tail", () => {
    const flat = Float64Array.of(0, 100, 100, 200, 300, 80)
    const next = patchTranscriptLayoutRows(rows, flat, rows.length)
    expect(next).not.toBe(rows)
    expect(next?.[0]).toBe(rows[0])
    expect(next?.[1]).toBe(rows[1])
    expect(next?.[2]).toEqual({ key: "slot:2", start: 300, size: 80 })
  })

  it("shifts later rows when an earlier box grows", () => {
    const flat = Float64Array.of(0, 140, 140, 200, 340, 50)
    const next = patchTranscriptLayoutRows(rows, flat, rows.length)
    expect(next?.[0]).toEqual({ key: "slot:0", start: 0, size: 140 })
    expect(next?.[1]).toEqual({ key: "slot:1", start: 140, size: 200 })
    expect(next?.[2]).toEqual({ key: "slot:2", start: 340, size: 50 })
  })

  it("refuses a partial or mismatched cache", () => {
    expect(
      patchTranscriptLayoutRows(rows, Float64Array.of(0, 100), 3)
    ).toBeNull()
    expect(
      patchTranscriptLayoutRows(rows, Float64Array.of(0, 100, 100, 200), 2)
    ).toBeNull()
  })
})
