import { afterEach, describe, expect, it, vi } from "vitest"
import {
  THEME_SURFACES,
  resolveThemeTarget,
  resolveThemeTargetAtPoint,
  surfaceById,
  surfaceByTarget,
  targetsSharingCssVar,
} from "@/lib/appearance-targets"

function mockEl(attrs: {
  magic?: boolean
  target?: string
  parent?: ReturnType<typeof mockEl> | null
}): {
  closest: (sel: string) => ReturnType<typeof mockEl> | null
  getAttribute: (name: string) => string | null
} {
  const self = {
    closest(sel: string) {
      if (sel === "[data-magic-chrome]") {
        if (attrs.magic) return self
        return attrs.parent?.closest(sel) ?? null
      }
      if (sel === "[data-theme-target]") {
        if (attrs.target) return self
        return attrs.parent?.closest(sel) ?? null
      }
      return null
    },
    getAttribute(name: string) {
      if (name === "data-theme-target") return attrs.target ?? null
      return null
    },
  }
  return self
}

describe("appearance-targets", () => {
  it("registers one surface per token; composer maps to card", () => {
    expect(THEME_SURFACES.every((s) => s.targets.length >= 1)).toBe(true)
    expect(surfaceByTarget("sidebar")?.cssVar).toBe("--sidebar")
    expect(surfaceById("background")?.cssVar).toBe("--background")
    expect(surfaceByTarget("composer")?.id).toBe("card")
    expect(surfaceByTarget("card")?.id).toBe("card")
    expect(surfaceByTarget("composer")?.cssVar).toBe("--card")
  })

  it("resolves known data-theme-target via closest", () => {
    const child = mockEl({
      parent: mockEl({ target: "sidebar" }),
    })
    expect(resolveThemeTarget(child as unknown as Element)?.id).toBe("sidebar")
    expect(resolveThemeTarget(child as unknown as Element)?.cssVar).toBe(
      "--sidebar"
    )
  })

  it("ignores magic chrome", () => {
    const child = mockEl({
      magic: true,
      parent: mockEl({ target: "sidebar" }),
    })
    expect(resolveThemeTarget(child as unknown as Element)).toBeNull()
  })

  it("picks nearest surface under nested children", () => {
    const child = mockEl({
      parent: mockEl({ target: "card" }),
    })
    expect(resolveThemeTarget(child as unknown as Element)?.id).toBe("card")
  })

  it("lists all targets sharing a css var", () => {
    expect(targetsSharingCssVar("--card").sort()).toEqual(
      ["card", "composer"].sort()
    )
    expect(targetsSharingCssVar("--sidebar")).toEqual(["sidebar"])
  })

  it("no-ops on unknown target or untagged", () => {
    expect(
      resolveThemeTarget(mockEl({ target: "nope" }) as unknown as Element)
    ).toBeNull()
    expect(resolveThemeTarget(mockEl({}) as unknown as Element)).toBeNull()
    expect(resolveThemeTarget(null)).toBeNull()
  })

  describe("resolveThemeTargetAtPoint", () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it("skips magic chrome stack entries and returns next surface", () => {
      const magic = mockEl({ magic: true })
      const under = mockEl({ target: "primary" })
      vi.stubGlobal("document", {
        elementsFromPoint: () => [magic, under],
      })
      expect(resolveThemeTargetAtPoint(10, 20)?.id).toBe("primary")
    })

    it("returns null when no surface under point", () => {
      const bare = mockEl({})
      vi.stubGlobal("document", {
        elementsFromPoint: () => [bare],
      })
      expect(resolveThemeTargetAtPoint(0, 0)).toBeNull()
    })

    it("resolves composer host to card token id", () => {
      const composer = mockEl({ target: "composer" })
      vi.stubGlobal("document", {
        elementsFromPoint: () => [composer],
      })
      expect(resolveThemeTargetAtPoint(1, 1)?.id).toBe("card")
    })
  })
})
