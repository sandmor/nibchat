import { describe, expect, it } from "vitest"
import {
  appearanceToJson,
  appearanceReferenceIssues,
  compileAppearance,
  defaultAppearance,
  motionTransition,
  parseAppearance,
  patchGroupFill,
  patchPalette,
  patchPaletteExtra,
  patchToken,
  addPaletteExtra,
  newPaletteExtraId,
  removePaletteExtra,
  SEED_THEMES,
  shouldAnimate,
  cssForColor,
} from "@/lib/appearance"
import { ref } from "@/lib/appearance-registry"

describe("appearance document", () => {
  it("normalizes CSS easing strings for Motion", () => {
    expect(
      motionTransition({
        enabled: true,
        durationMs: 300,
        ease: "ease-in-out",
        reducedMotion: "respect",
      })
    ).toEqual({ duration: 0.3, ease: [0.42, 0, 0.58, 1] })
    expect(
      motionTransition({
        enabled: true,
        durationMs: 180,
        ease: "cubic-bezier(0.1, -0.2, 0.8, 1.3)",
        reducedMotion: "respect",
      }).ease
    ).toEqual([0.1, -0.2, 0.8, 1.3])
    const doc = parseAppearance({
      motion: {
        enabled: true,
        durationMs: 240,
        ease: "ease-in-out",
        reducedMotion: "respect",
      },
    })
    expect(compileAppearance(doc)["--motion-ease"]).toBe(
      "cubic-bezier(0.42, 0, 0.58, 1)"
    )
  })

  it("applies the JSON reduced-motion policy consistently", () => {
    const base = {
      enabled: true,
      durationMs: 220,
      ease: "linear" as const,
    }
    expect(shouldAnimate({ ...base, reducedMotion: "respect" }, true)).toBe(
      false
    )
    expect(shouldAnimate({ ...base, reducedMotion: "never" }, true)).toBe(true)
    expect(shouldAnimate({ ...base, reducedMotion: "always" }, false)).toBe(
      false
    )
  })

  it("seeds full documents from palettes", () => {
    for (const seed of SEED_THEMES) {
      expect(seed.document.version).toBe(1)
      expect(seed.document.scheme).toBe(seed.id === "ink" ? "dark" : "light")
      expect(seed.document.palette.paper).toBeTruthy()
      expect(seed.document.messageActions.captions).toBe(false)
      expect(seed.document.modelPicker.showIds).toBe(false)
      expect(appearanceToJson(seed.document)).not.toMatch(/: null/)
      expect(parseAppearance(seed.document)).toEqual(seed.document)
    }
  })

  it("fills missing palette from Paper defaults", () => {
    const doc = parseAppearance({
      density: "compact",
      remoteStylesheet: "  https://example.com/theme.css  ",
    })
    expect(doc.palette.paper).toBe("oklch(1 0 0)")
    expect(doc.density).toBe("compact")
    expect(doc.remoteStylesheet).toBe("https://example.com/theme.css")
    const vars = compileAppearance(doc)
    expect(vars["--app-background"]).toBe("var(--palette-paper)")
    expect(vars["--background"]).toBe("var(--app-background)")
  })

  it("drops nulls so canonical JSON never stores them", () => {
    const doc = parseAppearance({
      remoteStylesheet: null,
    })
    expect(doc.remoteStylesheet).toBeUndefined()
    expect(appearanceToJson(doc)).not.toMatch(/: null/)
  })

  it("round-trips JSON", () => {
    const doc = defaultAppearance()
    const again = parseAppearance(JSON.parse(appearanceToJson(doc)))
    expect(again.palette.paper).toBe(doc.palette.paper)
    expect(again.messageActions.captions).toBe(false)
  })

  it("keeps unknown keys via loose object parse", () => {
    const doc = parseAppearance({
      palette: { paper: "oklch(1 0 0)" },
      customExtension: { ok: true },
    })
    expect((doc as { customExtension?: unknown }).customExtension).toEqual({
      ok: true,
    })
  })
})

describe("compileAppearance", () => {
  it("keeps linked tokens as var() so palette edits flow through", () => {
    const doc = defaultAppearance()
    const vars = compileAppearance(doc)
    expect(vars["--palette-paper"]).toBe(doc.palette.paper)
    expect(vars["--app-background"]).toBe("var(--palette-paper)")
    expect(vars["--app-foreground"]).toBe("var(--palette-ink)")
    expect(vars["--button"]).toBe("var(--palette-accent)")
  })

  it("palette edit updates linked tokens without rewriting them", () => {
    const next = patchPalette(
      defaultAppearance(),
      "paper",
      "oklch(0.9 0.02 80)"
    )
    const vars = compileAppearance(next)
    expect(vars["--palette-paper"]).toBe("oklch(0.9 0.02 80)")
    expect(vars["--app-background"]).toBe("var(--palette-paper)")
  })

  it("group fill does not clobber a surface override", () => {
    let doc = patchToken(defaultAppearance(), "--sidebar", {
      literal: "oklch(0.4 0.1 200)",
    })
    doc = patchGroupFill(doc, "sidebar", { ref: "accent" })
    const vars = compileAppearance(doc)
    expect(vars["--sidebar"]).toBe("oklch(0.4 0.1 200)")
    expect(vars["--group-sidebar-fill"]).toBe("var(--palette-accent)")
    expect(vars["--sidebar-hover"]).toContain("var(--group-sidebar-fill)")
  })

  it("group fill without override makes fill tokens follow the group", () => {
    const doc = patchGroupFill(defaultAppearance(), "sidebar", {
      ref: "accent",
    })
    const vars = compileAppearance(doc)
    expect(vars["--sidebar"]).toBe("var(--group-sidebar-fill)")
    expect(vars["--group-sidebar-fill"]).toBe("var(--palette-accent)")
  })

  it("literal token stays put when palette changes", () => {
    const overridden = patchToken(defaultAppearance(), "--composer", {
      literal: "oklch(0.7 0.2 40)",
    })
    const next = patchPalette(overridden, "paper", "oklch(0.2 0 0)")
    expect(compileAppearance(next)["--composer"]).toBe("oklch(0.7 0.2 40)")
  })

  it("recolorText paints group foreground from the group fill", () => {
    const doc = patchGroupFill(
      defaultAppearance(),
      "sidebar",
      { ref: "accent" },
      true
    )
    const vars = compileAppearance(doc)
    expect(vars["--sidebar-foreground"]).toBe("var(--group-sidebar-fill)")
  })
})

describe("palette extras", () => {
  it("slugs extra ids from names and avoids collisions", () => {
    const base = addPaletteExtra(defaultAppearance(), {
      id: "sidebar-wash",
      name: "Sidebar wash",
      value: "oklch(0.8 0.05 80)",
    })
    expect(newPaletteExtraId(base, "Sidebar wash")).toBe("sidebar-wash-2")
    expect(newPaletteExtraId(defaultAppearance(), "Sidebar wash")).toBe(
      "sidebar-wash"
    )
  })

  it("patches extra value and name", () => {
    const doc = addPaletteExtra(defaultAppearance(), {
      id: "wash",
      name: "Wash",
      value: "oklch(0.8 0.05 80)",
    })
    const next = patchPaletteExtra(doc, "wash", {
      name: "Sidebar",
      value: "oklch(0.7 0.04 70)",
    })
    expect(next.palette.extras[0]).toMatchObject({
      id: "wash",
      name: "Sidebar",
      value: "oklch(0.7 0.04 70)",
    })
  })

  it("removing an extra turns leftover refs into literals", () => {
    let doc = addPaletteExtra(defaultAppearance(), {
      id: "wash",
      name: "Wash",
      value: "oklch(0.8 0.05 80)",
    })
    doc = patchToken(doc, "--sidebar", { ref: "extra:wash" })
    doc = patchGroupFill(doc, "composer", { ref: "extra:wash" })
    const next = removePaletteExtra(doc, "wash")
    expect(next.palette.extras).toEqual([])
    expect(next.tokens["--sidebar"]).toEqual({
      literal: "oklch(0.8 0.05 80)",
    })
    expect(next.groups.composer?.fill).toEqual({
      literal: "oklch(0.8 0.05 80)",
    })
  })
})

describe("appearance references", () => {
  it("rejects direct and indirect group cycles", () => {
    const self = {
      ...defaultAppearance(),
      groups: { app: { fill: { ref: "group:app" } } },
    }
    expect(appearanceReferenceIssues(self)).toHaveLength(1)
    expect(() => parseAppearance(self)).toThrow(/cycle/i)

    const indirect = {
      ...defaultAppearance(),
      groups: {
        app: { fill: { ref: "group:sidebar" } },
        sidebar: { fill: { ref: "group:app" } },
      },
    }
    expect(() => parseAppearance(indirect)).toThrow(/cycle/i)
  })

  it("rejects dangling palette and group references", () => {
    expect(() =>
      parseAppearance({ tokens: { "--button": { ref: "extra:missing" } } })
    ).toThrow(/Unknown palette extra/)
    expect(() =>
      parseAppearance({ tokens: { "--button": { ref: "group:missing" } } })
    ).toThrow(/Unknown theme group/)
  })
})

describe("cssForColor", () => {
  it("emits palette vars, mixes, and alpha", () => {
    expect(cssForColor(ref("paper"))).toBe("var(--palette-paper)")
    expect(cssForColor({ ref: "paper", alpha: 0.4 })).toBe(
      "color-mix(in oklab, var(--palette-paper) 40%, transparent)"
    )
    expect(
      cssForColor({
        mix: { from: { ref: "ink" }, onto: { ref: "paper" }, amount: 0.08 },
      })
    ).toBe("color-mix(in oklab, var(--palette-ink) 8%, var(--palette-paper))")
  })
})
