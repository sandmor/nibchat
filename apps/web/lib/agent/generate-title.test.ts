import { describe, expect, it } from "vitest"
import { sanitizeGeneratedTitle } from "./generate-title"

describe("sanitizeGeneratedTitle", () => {
  it("strips wrapping quotes and bounds the title", () => {
    expect(sanitizeGeneratedTitle("  “Hello\n world” ")).toBe("Hello world")
    expect(sanitizeGeneratedTitle("x".repeat(100))).toHaveLength(72)
    expect(() => sanitizeGeneratedTitle('" "')).toThrow("empty")
  })
})
