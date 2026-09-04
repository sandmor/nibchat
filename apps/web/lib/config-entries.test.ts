import { describe, expect, it } from "vitest"
import {
  normalizeConfigEntries,
  resolveConfigEntries,
  resolveTemplateValue,
} from "@/lib/config-entries"

describe("config entries", () => {
  it("keeps name and value and drops unknown fields", () => {
    expect(
      normalizeConfigEntries([
        { name: "A", value: "${FOO}", extra: true },
        { name: "B", value: "literal" },
        { name: "C" },
        { name: "" },
      ])
    ).toEqual([
      { name: "A", value: "${FOO}" },
      { name: "B", value: "literal" },
      { name: "C", value: "" },
    ])
  })

  it("resolves template values and omits missing variables", () => {
    expect(resolveTemplateValue("Bearer ${TOKEN}", { TOKEN: "secret" })).toBe(
      "Bearer secret"
    )
    expect(
      resolveTemplateValue("Bearer ${MISSING}", { OTHER: "x" })
    ).toBeUndefined()
  })

  it("resolves entries and omits empty or unresolved values", () => {
    expect(
      resolveConfigEntries(
        [
          { name: "Authorization", value: "Bearer ${TOKEN}" },
          { name: "X-Empty", value: "${NOPE}" },
          { name: "X-Skip", value: "" },
        ],
        { TOKEN: "abc" }
      )
    ).toEqual({ Authorization: "Bearer abc" })
  })
})
