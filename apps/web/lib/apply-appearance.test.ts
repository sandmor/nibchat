import { describe, expect, it, vi } from "vitest"
import { defaultAppearance } from "@/lib/appearance"
import { createAppearanceApplier } from "@/lib/apply-appearance"

function appearanceRoot() {
  const properties = new Map<string, string>()
  const root = {
    style: {
      colorScheme: "",
      setProperty: vi.fn((name: string, value: string) => {
        properties.set(name, value)
      }),
      removeProperty: vi.fn((name: string) => {
        properties.delete(name)
      }),
    },
    dataset: {},
    classList: { toggle: vi.fn(), remove: vi.fn() },
  } as unknown as HTMLElement
  return { root, properties }
}

describe("appearance applier", () => {
  it("restores a directly previewed variable on document reconciliation", () => {
    const appearance = defaultAppearance()
    const { root, properties } = appearanceRoot()
    const applier = createAppearanceApplier(root)

    applier.apply(appearance)
    applier.applyVariable("--palette-accent", "oklch(0.4 0.1 40)")
    expect(properties.get("--palette-accent")).toBe("oklch(0.4 0.1 40)")

    applier.apply(appearance)
    expect(properties.get("--palette-accent")).toBe(appearance.palette.accent)
  })
})
