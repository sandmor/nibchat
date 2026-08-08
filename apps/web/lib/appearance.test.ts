import { describe, expect, it } from "vitest"
import {
  appearanceToJson,
  parseAppearance,
  presetDocument,
} from "@/lib/appearance"

describe("appearance document", () => {
  it("treats presets as full documents, not runtime modes", () => {
    const spatial = presetDocument("spatial")
    expect(spatial.vars["--primary"]).toBeTruthy()
    expect(spatial.density).toBe("comfortable")
    expect(spatial.messageActions.captions).toBe(false)
    expect(parseAppearance(spatial)).toEqual(spatial)
  })

  it("defaults message action captions off for all presets", () => {
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
    expect(doc.density).toBe("compact")
    expect(doc.remoteStylesheet).toBe("https://example.com/theme.css")
  })

  it("honors messageActions.captions when set", () => {
    const doc = parseAppearance({
      version: 1,
      vars: { "--background": "oklch(1 0 0)" },
      messageActions: { captions: true },
    })
    expect(doc.messageActions.captions).toBe(true)
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
