import { describe, expect, it } from "vitest"
import {
  isTranscriptLiveEdge,
  pickRestorePin,
  TRANSCRIPT_LIVE_EDGE_PX,
} from "./transcript-viewport-pin"

describe("isTranscriptLiveEdge", () => {
  it("is true within the MessageScroller edge threshold", () => {
    expect(
      isTranscriptLiveEdge({
        scrollTop: 392,
        scrollHeight: 500,
        clientHeight: 100,
      })
    ).toBe(true)
  })

  it("is false when the reader has scrolled away", () => {
    expect(
      isTranscriptLiveEdge({
        scrollTop: 200,
        scrollHeight: 500,
        clientHeight: 100,
      })
    ).toBe(false)
  })

  it("uses the same default threshold as the scroller", () => {
    expect(TRANSCRIPT_LIVE_EDGE_PX).toBe(8)
  })
})

describe("pickRestorePin", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }]

  it("prefers the first still-connected item", () => {
    expect(
      pickRestorePin(items, (item) => item.id === "a" || item.id === "c")?.id
    ).toBe("a")
  })

  it("falls back to the next connected item", () => {
    expect(pickRestorePin(items, (item) => item.id === "c")?.id).toBe("c")
  })

  it("returns null when every captured item is gone", () => {
    expect(pickRestorePin(items, () => false)).toBeNull()
    expect(pickRestorePin([], () => true)).toBeNull()
  })
})
