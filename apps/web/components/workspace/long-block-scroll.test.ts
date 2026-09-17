import { describe, expect, it } from "vitest"
import {
  isScrollportAtLiveEdge,
  SCROLLPORT_LIVE_EDGE_PX,
} from "./long-block-scroll"

function port(values: {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}) {
  return values as HTMLElement
}

describe("live-edge detection", () => {
  it("treats a missing scrollport as the live edge", () => {
    expect(isScrollportAtLiveEdge(null)).toBe(true)
  })

  it("matches the transcript follow threshold", () => {
    expect(
      isScrollportAtLiveEdge(
        port({ scrollHeight: 400, scrollTop: 300, clientHeight: 100 })
      )
    ).toBe(true)
    expect(
      isScrollportAtLiveEdge(
        port({
          scrollHeight: 400,
          scrollTop: 300 - SCROLLPORT_LIVE_EDGE_PX - 1,
          clientHeight: 100,
        })
      )
    ).toBe(false)
  })
})
