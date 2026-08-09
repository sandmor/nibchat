import { describe, expect, it } from "vitest"
import {
  ZERO_RADII,
  cornerRadiiFromComputed,
  intersectRects,
  roundedRectPath,
  shapesToEvenOddPath,
  type ViewportRect,
} from "@/lib/appearance-pick-geometry"

const full: ViewportRect = { top: 0, left: 0, width: 200, height: 100 }
const side: ViewportRect = { top: 0, left: 0, width: 60, height: 100 }

describe("appearance-pick-geometry", () => {
  it("intersects and clips rects", () => {
    expect(intersectRects(full, side)).toEqual(side)
    expect(
      intersectRects(full, { top: 200, left: 0, width: 10, height: 10 })
    ).toBeNull()
  })

  it("builds evenodd path with outer and hole", () => {
    const d = shapesToEvenOddPath(
      { ...full, radii: ZERO_RADII },
      [{ ...side, radii: ZERO_RADII }]
    )
    expect(d.startsWith("M0 0H200V100H0Z")).toBe(true)
    expect(d).toContain("M0 0H60V100H0Z")
    expect(d.match(/M/g)?.length).toBe(2)
  })

  it("skips degenerate holes in the path", () => {
    const d = shapesToEvenOddPath(
      { ...full, radii: ZERO_RADII },
      [{ top: 0, left: 0, width: 0, height: 50, radii: ZERO_RADII }]
    )
    expect(d.match(/M/g)?.length).toBe(1)
  })

  it("clamps huge radii to a pill/capsule half-box", () => {
    const r = cornerRadiiFromComputed(
      {
        borderTopLeftRadius: "9999px",
        borderTopRightRadius: "9999px",
        borderBottomRightRadius: "9999px",
        borderBottomLeftRadius: "9999px",
      },
      200,
      40
    )
    expect(r.tl).toBe(20)
    expect(r.tr).toBe(20)
    expect(r.br).toBe(20)
    expect(r.bl).toBe(20)
  })

  it("draws arc corners for rounded rects", () => {
    const d = roundedRectPath(
      { top: 10, left: 20, width: 100, height: 40 },
      { tl: 20, tr: 20, br: 20, bl: 20 }
    )
    expect(d).toContain("A20 20")
    expect(d).toMatch(/^M40 10/)
  })

  it("shapesToEvenOddPath keeps rounded outer and sharp holes", () => {
    const d = shapesToEvenOddPath(
      {
        top: 0,
        left: 0,
        width: 200,
        height: 100,
        radii: { tl: 12, tr: 12, br: 12, bl: 12 },
      },
      [{ ...side, radii: ZERO_RADII }]
    )
    expect(d).toContain("A12 12")
    expect(d.match(/M/g)?.length).toBe(2)
  })
})
