import { describe, expect, it } from "vitest"
import {
  appearanceToJson,
  applyAppearancePreset,
  defaultAppearance,
  motionTransition,
  parseAppearance,
  presetDocument,
  presetTemplates,
  shouldAnimate,
} from "@/lib/appearance"

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
    expect(doc.vars["--motion-ease"]).toBe("cubic-bezier(0.42, 0, 0.58, 1)")
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

  it("resolves starters into full documents, not patches", () => {
    const spatial = presetDocument("spatial")
    expect(spatial.vars["--primary"]).toBeTruthy()
    expect(spatial.vars["--background"]).toBeTruthy()
    expect(spatial.density).toBe("comfortable")
    expect(spatial.messageActions.captions).toBe(false)
    expect(spatial.modelPicker.showIds).toBe(false)
    expect(appearanceToJson(spatial)).not.toMatch(/: null/)
    expect(parseAppearance(spatial)).toEqual(spatial)
  })

  it("defaults message action captions off for all starters", () => {
    for (const id of ["default", "spatial", "editorial"] as const) {
      expect(presetDocument(id).messageActions.captions).toBe(false)
    }
  })

  it("fills missing vars from defaults", () => {
    const doc = parseAppearance({
      version: 1,
      density: "compact",
      remoteStylesheet: "  https://example.com/theme.css  ",
    })
    expect(doc.vars["--background"]).toBeTruthy()
    expect(doc.vars["--tree-grid-color"]).toContain("--muted-foreground")
    expect(doc.vars["--tree-minimap-node"]).toBe("var(--muted-foreground)")
    expect(doc.vars["--tree-minimap-path"]).toContain("--primary")
    expect(doc.vars["--tree-shadow-lg"]).toContain("--foreground")
    expect(doc.vars["--motion-spinner-duration"]).toBe("900ms")
    expect(doc.density).toBe("compact")
    expect(doc.remoteStylesheet).toBe("https://example.com/theme.css")
  })

  it("hides model ids in chat chrome by default", () => {
    expect(defaultAppearance().modelPicker.showIds).toBe(false)
  })

  it("honors modelPicker.showIds when set", () => {
    const doc = parseAppearance({
      version: 1,
      modelPicker: { showIds: true },
    })
    expect(doc.modelPicker.showIds).toBe(true)
  })

  it("drops nulls so canonical JSON never stores them", () => {
    const doc = parseAppearance({
      version: 1,
      remoteStylesheet: null,
      vars: {
        "--background": "oklch(1 0 0)",
        "--radius": null,
      },
    })
    expect(doc.remoteStylesheet).toBeUndefined()
    expect(doc.vars["--radius"]).toBeUndefined()
    expect(doc.vars["--background"]).toBe("oklch(1 0 0)")
    expect(appearanceToJson(doc)).not.toMatch(/: null/)
  })

  it("round-trips JSON", () => {
    const doc = presetDocument("default")
    const again = parseAppearance(JSON.parse(appearanceToJson(doc)))
    expect(again.vars["--background"]).toBe(doc.vars["--background"])
    expect(again.messageActions.captions).toBe(false)
  })

  it("keeps unknown keys via loose object parse", () => {
    const doc = parseAppearance({
      version: 1,
      vars: { "--radius": "1rem" },
      customExtension: { ok: true },
    })
    expect((doc as { customExtension?: unknown }).customExtension).toEqual({
      ok: true,
    })
  })
})

describe("applyAppearancePreset", () => {
  it("keeps chrome the starter omits", () => {
    const current = parseAppearance({
      ...defaultAppearance(),
      messageActions: { captions: true },
      modelPicker: { showIds: true },
      vars: {
        ...defaultAppearance().vars,
        "--foo": "1px",
      },
    })
    const next = applyAppearancePreset(
      current,
      presetTemplates.spatial.document
    )
    expect(next.messageActions.captions).toBe(true)
    expect(next.vars["--foo"]).toBe("1px")
    expect(next.modelPicker.showIds).toBe(true)
    expect(next.vars["--primary"]).toBe(
      presetTemplates.spatial.document.vars["--primary"]
    )
    expect(next.density).toBe("comfortable")
    expect(appearanceToJson(next)).not.toMatch(/: null/)
  })

  it("resets the token map when vars is null", () => {
    const current = parseAppearance({
      ...defaultAppearance(),
      messageActions: { captions: true },
      remoteStylesheet: "https://example.com/extra.css",
      vars: {
        ...defaultAppearance().vars,
        "--foo": "1px",
        "--primary": "oklch(0.1 0 0)",
      },
    })
    const next = applyAppearancePreset(
      current,
      presetTemplates.default.document
    )
    expect(next.vars["--foo"]).toBeUndefined()
    expect(next.vars["--primary"]).toBe(defaultAppearance().vars["--primary"])
    expect(next.messageActions.captions).toBe(true)
    expect(next.remoteStylesheet).toBeUndefined()
  })

  it("deletes one token with null", () => {
    const current = defaultAppearance()
    const next = applyAppearancePreset(current, {
      vars: { "--radius": null },
    })
    expect(next.vars["--radius"]).toBeUndefined()
    expect(next.vars["--background"]).toBe(current.vars["--background"])
  })
})
