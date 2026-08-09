import { describe, expect, it } from "vitest"
import {
  DEFAULT_ORB_LAYOUT,
  minArcSeparation,
  orbitRadius,
  placeSatellitesOnArc,
} from "@/lib/appearance-orb-layout"

describe("appearance-orb-layout", () => {
  it("places save at top and close further left along the arc", () => {
    const placements = placeSatellitesOnArc(DEFAULT_ORB_LAYOUT)
    const save = placements.find((p) => p.id === "save")!
    const close = placements.find((p) => p.id === "close")!
    // Save nearly straight above center
    expect(Math.abs(save.x)).toBeLessThan(1)
    expect(save.y).toBeLessThan(0)
    // Close left of save (negative x) and below pure top
    expect(close.x).toBeLessThan(save.x)
    expect(close.y).toBeGreaterThan(save.y)
  })

  it("uses arc length s = R·Δθ equal to min satellite separation", () => {
    const layout = DEFAULT_ORB_LAYOUT
    const R = orbitRadius(layout)
    const placements = placeSatellitesOnArc(layout)
    const save = placements.find((p) => p.id === "save")!
    const close = placements.find((p) => p.id === "close")!
    const dTheta = close.theta - save.theta
    const arc = R * dTheta
    expect(arc).toBeCloseTo(minArcSeparation(layout), 6)
    // Center-to-center chord should be enough that rims + seam don’t overlap
    const dx = close.x - save.x
    const dy = close.y - save.y
    const chord = Math.hypot(dx, dy)
    expect(chord).toBeGreaterThanOrEqual(layout.smallSize)
  })

  it("keeps satellites outside the main disc", () => {
    const layout = DEFAULT_ORB_LAYOUT
    const mainR = layout.mainSize / 2
    const smallR = layout.smallSize / 2
    for (const p of placeSatellitesOnArc(layout)) {
      const dist = Math.hypot(p.x, p.y)
      expect(dist - smallR).toBeGreaterThanOrEqual(mainR + layout.edgeGap - 0.01)
    }
  })
})
