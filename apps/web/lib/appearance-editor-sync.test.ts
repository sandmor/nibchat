import { describe, expect, it } from "vitest"
import {
  appearanceToJson,
  defaultAppearance,
  parseAppearance,
} from "@/lib/appearance"
import { reconcileEditorText } from "@/lib/appearance-editor-sync"

describe("reconcileEditorText", () => {
  it("preserves formatting when content is canonically equal", () => {
    const draft = defaultAppearance()
    const compact = appearanceToJson(draft, false)
    const result = reconcileEditorText(compact, draft)
    expect(result.replaced).toBe(false)
    expect(result.text).toBe(compact)
  })

  it("replaces when draft diverged", () => {
    const a = defaultAppearance()
    const b = parseAppearance({
      ...a,
      vars: { ...a.vars, "--primary": "oklch(0.2 0 0)" },
    })
    const result = reconcileEditorText(appearanceToJson(a), b)
    expect(result.replaced).toBe(true)
    expect(result.text).toBe(appearanceToJson(b))
  })

  it("replaces invalid buffer with draft SOT", () => {
    const draft = defaultAppearance()
    const result = reconcileEditorText("{ broken", draft)
    expect(result.replaced).toBe(true)
    expect(result.text).toBe(appearanceToJson(draft))
  })
})
