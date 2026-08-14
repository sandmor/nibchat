import { describe, expect, it } from "vitest"
import {
  centerOnRect,
  clampScale,
  elementCanScroll,
  nodePaint,
  panBy,
  rectFullyVisible,
  worldViewRect,
  zoomToward,
} from "./tree-camera"

describe("tree camera", () => {
  it("zooms toward a viewport point without dragging that world point", () => {
    const camera = { x: 40, y: 20, scale: 1 }
    const point = { x: 200, y: 100 }
    const next = zoomToward(camera, 2, point)
    const world = {
      x: (point.x - camera.x) / camera.scale,
      y: (point.y - camera.y) / camera.scale,
    }
    expect(point.x - next.x).toBeCloseTo(world.x * next.scale)
    expect(point.y - next.y).toBeCloseTo(world.y * next.scale)
  })

  it("reports the world rectangle matching a CSS translate/scale camera", () => {
    const camera = { x: 48, y: 36, scale: 0.5 }
    expect(worldViewRect(camera, { width: 800, height: 400 })).toEqual({
      x: -96,
      y: -72,
      width: 1600,
      height: 800,
    })
  })

  it("centers a card in the viewport", () => {
    const camera = centerOnRect(
      { x: 0, y: 0, scale: 1 },
      { x: 100, y: 50, width: 200, height: 100 },
      { width: 800, height: 600 }
    )
    expect(camera.x).toBe(800 / 2 - 200)
    expect(camera.y).toBe(600 / 2 - 100)
  })

  it("clamps scale and pans in screen pixels", () => {
    expect(clampScale(0.01)).toBe(0.2)
    expect(clampScale(8)).toBe(1.2)
    expect(panBy({ x: 10, y: 4, scale: 1 }, 5, -2)).toEqual({
      x: 15,
      y: 2,
      scale: 1,
    })
  })
})

describe("nodePaint", () => {
  const rect = { x: 0, y: 0, width: 360, height: 160 }

  it("keeps interactive nodes live even when tiny on screen", () => {
    expect(nodePaint({ rect, scale: 0.1, interactive: true })).toBe("live")
  })

  it("stubs cards that would be unreadably small", () => {
    expect(nodePaint({ rect, scale: 0.15, interactive: false })).toBe("stub")
  })

  it("renders the real message once a card is large enough to read", () => {
    expect(nodePaint({ rect, scale: 0.8, interactive: false })).toBe("live")
  })
})

describe("elementCanScroll", () => {
  it("keeps vertical wheel input while a card can still scroll", () => {
    expect(
      elementCanScroll(
        {
          scrollHeight: 400,
          clientHeight: 100,
          scrollTop: 20,
          scrollWidth: 100,
          clientWidth: 100,
          scrollLeft: 0,
        },
        0,
        40
      )
    ).toBe(true)
  })

  it("gives the wheel back when the card has no overflow", () => {
    expect(
      elementCanScroll(
        {
          scrollHeight: 100,
          clientHeight: 100,
          scrollTop: 0,
          scrollWidth: 100,
          clientWidth: 100,
          scrollLeft: 0,
        },
        0,
        40
      )
    ).toBe(false)
  })

  it("gives the wheel back at the end of the scroller", () => {
    expect(
      elementCanScroll(
        {
          scrollHeight: 400,
          clientHeight: 100,
          scrollTop: 300,
          scrollWidth: 100,
          clientWidth: 100,
          scrollLeft: 0,
        },
        0,
        40
      )
    ).toBe(false)
  })
})

describe("rectFullyVisible", () => {
  it("is false when a composer would sit below the viewport", () => {
    expect(
      rectFullyVisible(
        { x: 40, y: 300, width: 360, height: 220 },
        { x: 0, y: 0, scale: 1 },
        { width: 800, height: 400 }
      )
    ).toBe(false)
  })

  it("is true when the rect already fits with padding", () => {
    expect(
      rectFullyVisible(
        { x: 40, y: 40, width: 360, height: 220 },
        { x: 0, y: 0, scale: 1 },
        { width: 800, height: 600 }
      )
    ).toBe(true)
  })
})
