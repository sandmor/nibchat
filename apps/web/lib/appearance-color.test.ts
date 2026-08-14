import { describe, expect, it } from "vitest"
import { defaultAppearance } from "@/lib/appearance"
import {
  cssColorToOklch,
  formatOklch,
  resolveColorValue,
} from "@/lib/appearance-color"
import { ref } from "@/lib/appearance-registry"

describe("appearance-color", () => {
  it("parses oklch with alpha", () => {
    const color = cssColorToOklch("oklch(0.5 0.1 40 / 0.4)")
    expect(color.alpha).toBeCloseTo(0.4, 2)
    expect(formatOklch(color)).toContain("/")
  })

  it("resolves palette refs through the document", () => {
    const doc = defaultAppearance()
    expect(resolveColorValue(doc, ref("paper"))).toBe(doc.palette.paper)
    expect(resolveColorValue(doc, { ref: "accent", alpha: 0.5 })).toContain(
      "oklch("
    )
  })

  it("falls back safely for an invalid in-memory group cycle", () => {
    const doc = defaultAppearance()
    const cyclic = {
      ...doc,
      groups: { app: { fill: { ref: "group:app" } } },
    }
    expect(resolveColorValue(cyclic, { ref: "group:app" })).toBe(
      doc.palette.paper
    )
  })
})
