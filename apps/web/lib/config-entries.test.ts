import { describe, expect, it } from "vitest"
import {
  normalizeConfigEntries,
  resolveConfigEntries,
  resolveTemplateValue,
  resolveHeaderEntries,
  previewHeaderEntry,
} from "@/lib/config-entries"
import { catalogMacroContext } from "@/lib/prompt-macros"

describe("config entries", () => {
  it("isolates reply and title headers and omits them outside generation requests", () => {
    const context = catalogMacroContext("UTC")
    const entries = [
      { name: "X-Kind", value: "{{requestKind}}" },
      {
        name: "X-Session",
        value: '{{concat(chatId, "|", branchId, "|", requestKind)}}',
      },
      {
        name: "X-Conditional",
        value: '{{if requestKind == "title"}}titles{{else}}replies{{/if}}',
      },
      { name: "X-Literal", value: "configured" },
    ]
    const reply = resolveHeaderEntries(entries, { macroContext: context })
    const title = resolveHeaderEntries(entries, {
      macroContext: { ...context, requestKind: "title" },
    })
    expect(reply).toMatchObject({
      "X-Kind": "reply",
      "X-Session": `${context.chat!.id}|/1|reply`,
      "X-Conditional": "replies",
    })
    expect(title).toMatchObject({
      "X-Kind": "title",
      "X-Session": `${context.chat!.id}|/1|title`,
      "X-Conditional": "titles",
    })
    expect(resolveHeaderEntries(entries)).toEqual({ "X-Literal": "configured" })
    expect(
      resolveHeaderEntries(entries, {
        macroContext: { ...context, requestKind: undefined },
      })
    ).toEqual({ "X-Literal": "configured" })
    expect(previewHeaderEntry(entries[1]!, context)).toMatchObject({
      expanded: reply["X-Session"],
      titleExpanded: title["X-Session"],
      omittedWithoutRequest: true,
      unresolved: false,
      invalid: false,
    })
  })
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
