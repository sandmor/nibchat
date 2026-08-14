import { afterEach, describe, expect, it, vi } from "vitest"
import {
  resolveThemeHit,
  resolveThemeHitAtPoint,
  surfaceById,
  surfaceByTarget,
} from "@/lib/appearance-targets"

function mockEl(attrs: {
  magic?: boolean
  target?: string
  group?: string
  parent?: ReturnType<typeof mockEl> | null
}): {
  closest: (sel: string) => ReturnType<typeof mockEl> | null
  getAttribute: (name: string) => string | null
  parentElement: ReturnType<typeof mockEl> | null
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
      if (sel === "[data-theme-group]") {
        if (attrs.group) return self
        return attrs.parent?.closest(sel) ?? null
      }
      if (sel === "[data-theme-target], [data-theme-group]") {
        if (attrs.target || attrs.group) return self
        return attrs.parent?.closest(sel) ?? null
      }
      return null
    },
    getAttribute(name: string) {
      if (name === "data-theme-target") return attrs.target ?? null
      if (name === "data-theme-group") return attrs.group ?? null
      return null
    },
    get parentElement() {
      return attrs.parent ?? null
    },
  }
  return self
}

describe("appearance-targets", () => {
  it("maps composer and messages to their own tokens", () => {
    expect(surfaceByTarget("sidebar")?.cssVar).toBe("--sidebar")
    expect(surfaceById("app-background")?.cssVar).toBe("--app-background")
    expect(surfaceByTarget("composer")?.cssVar).toBe("--composer")
    expect(surfaceByTarget("message-user")?.cssVar).toBe("--message-user")
  })

  it("resolves known data-theme-target via closest", () => {
    const child = mockEl({
      parent: mockEl({ target: "sidebar" }),
    })
    const hit = resolveThemeHit(child as unknown as Element)
    expect(hit?.surface?.id).toBe("sidebar")
    expect(hit?.surface?.cssVar).toBe("--sidebar")
  })

  it("ignores magic chrome", () => {
    const child = mockEl({
      magic: true,
      parent: mockEl({ target: "sidebar" }),
    })
    expect(resolveThemeHit(child as unknown as Element)).toBeNull()
  })

  it("picks nearest surface under nested children", () => {
    const child = mockEl({
      parent: mockEl({ target: "composer" }),
    })
    expect(resolveThemeHit(child as unknown as Element)?.surface?.id).toBe(
      "composer"
    )
  })

  it("selects a group host when no surface is tagged", () => {
    const child = mockEl({
      parent: mockEl({ group: "sidebar" }),
    })
    const hit = resolveThemeHit(child as unknown as Element)
    expect(hit?.kind).toBe("group")
    expect(hit?.group.id).toBe("sidebar")
    expect(hit?.surface).toBeNull()
  })

  it("prefers a nested surface over the wrapping group", () => {
    const child = mockEl({
      target: "sidebar-hover",
      parent: mockEl({ group: "sidebar", target: "sidebar" }),
    })
    const hit = resolveThemeHit(child as unknown as Element)
    expect(hit?.kind).toBe("surface")
    expect(hit?.surface?.id).toBe("sidebar-hover")
    expect(hit?.group.id).toBe("sidebar")
  })

  describe("resolveThemeHitAtPoint", () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it("skips magic chrome stack entries and returns next surface", () => {
      const magic = mockEl({ magic: true })
      const under = mockEl({ target: "sidebar" })
      vi.stubGlobal("document", {
        elementsFromPoint: () => [magic, under],
      })
      const hit = resolveThemeHitAtPoint(1, 1)
      expect(hit?.kind).toBe("surface")
      expect(hit?.surface?.id).toBe("sidebar")
    })

    it("returns null when every stack entry is magic chrome", () => {
      vi.stubGlobal("document", {
        elementsFromPoint: () => [mockEl({ magic: true, target: "sidebar" })],
      })
      expect(resolveThemeHitAtPoint(0, 0)).toBeNull()
    })
  })
})
