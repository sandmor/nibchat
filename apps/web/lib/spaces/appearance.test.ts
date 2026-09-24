import { describe, expect, it } from "vitest"
import { defaultAppearance, type ThemeRecord } from "@/lib/appearance"
import {
  assertAppearancePatch,
  resolveSpaceAppearance,
} from "@/lib/spaces/appearance"
import type { SpaceRecord } from "@/lib/spaces/tree"

const theme: ThemeRecord = {
  id: "theme",
  name: "Theme",
  document: defaultAppearance(),
  created_at: "",
  updated_at: "",
}

function space(
  id: string,
  parent_id: string | null,
  appearance: SpaceRecord["settings"]["appearance"]
): SpaceRecord {
  return { id, parent_id, name: id, settings: { appearance } }
}

describe("space appearance", () => {
  it("rejects unsafe paths and policies without values", () => {
    expect(() =>
      assertAppearancePatch({
        values: JSON.parse('{"__proto__":{"polluted":true}}'),
      })
    ).toThrow()
    expect(() =>
      assertAppearancePatch({ policies: { "/__proto__/polluted": "release" } })
    ).toThrow()
    expect(() =>
      assertAppearancePatch({ policies: { "/density": "require" } })
    ).toThrow()
  })
  it("layers shared patches before slot patches across nested spaces", () => {
    const spaces = [
      space("parent", null, {
        shared: { values: { palette: { accent: "red" }, density: "compact" } },
        dark: { values: { palette: { accent: "blue" } } },
      }),
      space("child", "parent", {
        shared: { values: { palette: { accent: "green" } } },
      }),
    ]
    const light = resolveSpaceAppearance({
      spaceId: "child",
      spaces,
      slot: "light",
      userThemeId: "theme",
      themes: [theme],
    })
    const dark = resolveSpaceAppearance({
      spaceId: "child",
      spaces,
      slot: "dark",
      userThemeId: "theme",
      themes: [theme],
    })
    expect(light.document.palette.accent).toBe("green")
    expect(dark.document.palette.accent).toBe("blue")
    expect(dark.document.density).toBe("compact")
  })

  it("releases one inherited value to the base and preserves unrelated values", () => {
    const spaces = [
      space("parent", null, {
        shared: { values: { density: "compact", radius: "2rem" } },
      }),
      space("child", "parent", {
        shared: { policies: { "/density": "release" } },
      }),
    ]
    const result = resolveSpaceAppearance({
      spaceId: "child",
      spaces,
      slot: "light",
      userThemeId: "theme",
      themes: [theme],
    })
    expect(result.document.density).toBe(theme.document.density)
    expect(result.document.radius).toBe("2rem")
  })

  it("lets a required shared value defeat a slot value and supports explicit reset", () => {
    const spaces = [
      space("parent", null, {
        shared: {
          values: { density: "compact", radius: "2rem" },
          policies: { "/density": "require" },
        },
      }),
      space("child", "parent", {
        shared: {
          reset: true,
          values: { density: "compact" },
          policies: { "/density": "require" },
        },
        dark: { values: { density: "comfortable" } },
      }),
    ]
    const result = resolveSpaceAppearance({
      spaceId: "child",
      spaces,
      slot: "dark",
      userThemeId: "theme",
      themes: [theme],
    })
    expect(result.document.density).toBe("compact")
    expect(result.document.radius).toBe(theme.document.radius)
  })
})
