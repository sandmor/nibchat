import { describe, expect, it } from "vitest"
import {
  CENTER_SCALE,
  MIN_SCALE,
  VIEW_CULL_STEP,
  WORK_ENTER,
  WORK_LEAVE,
  applyCameraTransform,
  applyZoomCssVars,
  cameraTransform,
  centerOnRect,
  clampScale,
  createTreeViewStore,
  edgeStrokeFactor,
  elementCanScroll,
  nodePaint,
  panBy,
  rectFullyVisible,
  scaleForLivePaint,
  scaleToReadCard,
  stepZoomTier,
  treeViewSnapshot,
  viewNeedsRecull,
  visibleIds,
  visibleSignature,
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
    expect(clampScale(0.01)).toBe(MIN_SCALE)
    expect(clampScale(8)).toBe(1.2)
    expect(panBy({ x: 10, y: 4, scale: 1 }, 5, -2)).toEqual({
      x: 15,
      y: 2,
      scale: 1,
    })
  })

  it("writes a CSS transform without going through React state", () => {
    const el = { style: { transform: "" } }
    const camera = { x: 12, y: -4, scale: 0.5 }
    applyCameraTransform(el, camera)
    expect(el.style.transform).toBe(cameraTransform(camera))
    expect(el.style.transform).toBe("translate(12px, -4px) scale(0.5)")
  })
})

describe("zoom tiers", () => {
  it("leaves work at the leave threshold and re-enters with hysteresis", () => {
    expect(stepZoomTier("work", 0.82)).toBe("work")
    expect(stepZoomTier("work", WORK_LEAVE)).toBe("map")
    expect(stepZoomTier("map", 0.7)).toBe("map")
    expect(stepZoomTier("map", WORK_ENTER)).toBe("work")
  })

  it("does not thicken edge strokes while still in work zoom", () => {
    expect(edgeStrokeFactor(0.82)).toBe(1)
    expect(edgeStrokeFactor(WORK_LEAVE)).toBe(1)
    expect(edgeStrokeFactor(0.7)).toBe(1)
    expect(edgeStrokeFactor(0.34)).toBeCloseTo(WORK_LEAVE / 0.34)
  })

  it("writes inverse-scale edge widths for the canvas CSS to consume", () => {
    const props = new Map<string, string>()
    applyZoomCssVars(
      {
        style: {
          setProperty(name, value) {
            props.set(name, value)
          },
        },
      },
      0.34
    )
    const factor = WORK_LEAVE / 0.34
    expect(props.get("--tree-edge-width")).toBe(`${1.5 * factor}px`)
    expect(props.get("--tree-edge-lit-width")).toBe(`${3 * factor}px`)
  })
})

describe("nodePaint", () => {
  const rect = { x: 0, y: 0, width: 360, height: 160 }

  it("keeps interactive nodes live even when tiny on screen", () => {
    expect(
      nodePaint({ rect, scale: 0.1, tier: "map", interactive: true })
    ).toBe("live")
  })

  it("stubs cards that would be unreadably small", () => {
    expect(
      nodePaint({ rect, scale: 0.15, tier: "map", interactive: false })
    ).toBe("stub")
  })

  it("renders the real message in work once a card is large enough to read", () => {
    expect(
      nodePaint({ rect, scale: 0.8, tier: "work", interactive: false })
    ).toBe("live")
  })

  it("paints a plaque in map when the card is still large enough", () => {
    expect(
      nodePaint({ rect, scale: 0.5, tier: "map", interactive: false })
    ).toBe("map")
  })

  it("bumps a stub-scale camera until the card paints live", () => {
    const scale = scaleForLivePaint(rect, 0.15)
    expect(nodePaint({ rect, scale, tier: "work", interactive: false })).toBe(
      "live"
    )
    expect(scale).toBeGreaterThanOrEqual(CENTER_SCALE)
    expect(scale).toBeGreaterThanOrEqual(WORK_ENTER)
  })
})

describe("scaleToReadCard", () => {
  const rect = { x: 0, y: 0, width: 360, height: 160 }

  it("keeps the current scale when the card already paints live", () => {
    expect(scaleToReadCard(rect, { x: 0, y: 0, scale: 0.82 }, "work")).toBe(
      0.82
    )
  })

  it("raises a map-tier camera into work so the card becomes readable", () => {
    const scale = scaleToReadCard(rect, { x: 0, y: 0, scale: 0.5 }, "map")
    expect(scale).toBeGreaterThanOrEqual(WORK_ENTER)
    expect(nodePaint({ rect, scale, tier: "work", interactive: false })).toBe(
      "live"
    )
  })

  it("raises a stub-scale camera until the card is tall enough on screen", () => {
    const scale = scaleToReadCard(rect, { x: 0, y: 0, scale: 0.15 }, "map")
    expect(nodePaint({ rect, scale, tier: "work", interactive: false })).toBe(
      "live"
    )
  })
})

describe("visible signature", () => {
  it("sorts overlapping ids so a pan that keeps the same set does not change", () => {
    const rects = new Map([
      ["b", { x: 400, y: 0, width: 100, height: 100 }],
      ["a", { x: 0, y: 0, width: 100, height: 100 }],
      ["c", { x: 2000, y: 0, width: 100, height: 100 }],
    ])
    const view = { x: 0, y: 0, width: 800, height: 400 }
    const ids = visibleIds(rects, view, 0)
    expect(ids).toEqual(["a", "b"])
    expect(visibleSignature(ids)).toBe("a\0b")
    expect(visibleSignature(visibleIds(rects, { ...view, x: 10 }, 0))).toBe(
      "a\0b"
    )
  })

  it("includes a card once the view pans onto it", () => {
    const rects = new Map([
      ["near", { x: 0, y: 0, width: 100, height: 100 }],
      ["far", { x: 0, y: 2000, width: 100, height: 100 }],
    ])
    const view = { x: 0, y: 0, width: 800, height: 400 }
    expect(visibleIds(rects, view, 0)).toEqual(["near"])
    expect(
      visibleIds(rects, { x: 0, y: 1800, width: 800, height: 400 }, 0)
    ).toEqual(["far"])
  })
})

describe("view recull", () => {
  const view = { x: 0, y: 0, width: 800, height: 400 }

  it("waits until the camera has moved a slice of the cull pad", () => {
    expect(
      viewNeedsRecull(view, { ...view, x: VIEW_CULL_STEP - 1 }, false)
    ).toBe(false)
    expect(viewNeedsRecull(view, { ...view, x: VIEW_CULL_STEP }, false)).toBe(
      true
    )
  })

  it("reculls on zoom even if the view origin did not move", () => {
    expect(viewNeedsRecull(view, view, true)).toBe(true)
  })
})

describe("tree view store", () => {
  it("notifies when the visible set changes and stays quiet when it does not", () => {
    const store = createTreeViewStore({
      sig: "",
      ids: new Set(),
      scale: 0.82,
      tier: "work",
      paintSig: "",
    })
    let notices = 0
    const stop = store.subscribe(() => {
      notices += 1
    })
    expect(
      store.commit({
        sig: "a",
        ids: new Set(["a"]),
        scale: 0.82,
        tier: "work",
        paintSig: "a:live",
      })
    ).toBe(true)
    expect(notices).toBe(1)
    expect(store.getSnapshot().ids.has("a")).toBe(true)
    expect(
      store.commit({
        sig: "a",
        ids: new Set(["a"]),
        scale: 0.82,
        tier: "work",
        paintSig: "a:live",
      })
    ).toBe(false)
    expect(notices).toBe(1)
    expect(
      store.commit({
        sig: "a\0b",
        ids: new Set(["a", "b"]),
        scale: 0.82,
        tier: "work",
        paintSig: "a:live|b:live",
      })
    ).toBe(true)
    expect(notices).toBe(2)
    stop()
  })

  it("pans a camera onto a distant card and notifies the store", () => {
    const rects = new Map([
      ["near", { x: 0, y: 0, width: 100, height: 100 }],
      ["far", { x: 0, y: 2000, width: 100, height: 100 }],
    ])
    const viewport = { width: 800, height: 400 }
    const startCamera = { x: 0, y: 0, scale: 1 }
    const start = treeViewSnapshot(rects, startCamera, viewport, "work")
    expect([...start.ids]).toEqual(["near"])
    const next = treeViewSnapshot(
      rects,
      panBy(startCamera, 0, -1800),
      viewport,
      start.tier
    )
    expect([...next.ids]).toEqual(["far"])
    const store = createTreeViewStore(start)
    expect(store.commit(next)).toBe(true)
    expect(store.getSnapshot().ids.has("far")).toBe(true)
  })

  it("reuses the previous snapshot when the visible set did not change", () => {
    const rects = new Map([["near", { x: 0, y: 0, width: 100, height: 100 }]])
    const viewport = { width: 800, height: 400 }
    const start = treeViewSnapshot(
      rects,
      { x: 0, y: 0, scale: 1 },
      viewport,
      "work"
    )
    const next = treeViewSnapshot(
      rects,
      panBy({ x: 0, y: 0, scale: 1 }, 0, -10),
      viewport,
      start.tier,
      start
    )
    expect(next).toBe(start)
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
