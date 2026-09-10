import { describe, expect, it } from "vitest"
import {
  builtInMacroDefinitions,
  catalogMacroContext,
  createMacroRegistry,
  defaultMacroContext,
  expandPromptMacros,
  groupedMacroPickerEntries,
  idleSinceFromPath,
  macroPickerEntries,
  macroPickerPreview,
  normalizeTimeZone,
  SAMPLE_MACRO_CHAT,
  type MacroDefinition,
} from "@/lib/prompt-macros"

const context = defaultMacroContext({
  now: new Date("2026-04-16T09:28:00.000Z"),
  timeZone: "America/Bogota",
  idleSince: new Date("2026-04-16T07:28:00.000Z"),
  chat: {
    id: "chat-1",
    createdAt: new Date("2026-04-16T08:00:00.000Z"),
  },
})

describe("prompt macros", () => {
  it("formats the built-in date and time macros in the supplied time zone", () => {
    expect(
      expandPromptMacros(
        "{{time}} | {{time::UTC+5:30}} | {{date}} | {{weekday}} | {{isotime}} | {{isodate}} | {{datetimeformat::YYYY-MM-DD HH:mm}}",
        context
      )
    ).toBe(
      "4:28 AM | 2:58 PM | 4/16/2026 | Thursday | 04:28 | 2026-04-16 | 2026-04-16 04:28"
    )
  })

  it("expands nested macro arguments and humanizes time values", () => {
    expect(expandPromptMacros("{{idleDuration}}", context)).toBe("2 hours")
    expect(
      expandPromptMacros(
        "{{timeDiff::{{isodate}} 12:00::2026-04-16 15:00}}",
        context
      )
    ).toBe("3 hours")
  })

  it("expands chat identity and integer transforms", () => {
    expect(expandPromptMacros("{{chatId}}", context)).toBe("chat-1")
    expect(expandPromptMacros("{{chatCreatedAt}}", context)).toBe(
      "2026-04-16T08:00:00.000Z"
    )
    expect(expandPromptMacros("{{chatCreatedAt::x}}", context)).toBe(
      String(context.chat!.createdAt.getTime())
    )
    expect(expandPromptMacros("{{add::1::2}} {{mul::2::4096}}", context)).toBe(
      "3 8192"
    )
    expect(expandPromptMacros("{{bitnot::1}} {{hex::255}}", context)).toBe(
      "-2 ff"
    )
  })

  it("hashes and slices nested chat identity", () => {
    const nested = "{{slice::{{hash::{{chatId}}::base62}}::0::14}}"
    const value = expandPromptMacros(nested, context)
    expect(value).toHaveLength(14)
    expect(value).not.toContain("{")
    expect(expandPromptMacros("{{chatId}}", defaultMacroContext())).toBe(
      "{{chatId}}"
    )
  })

  it("preserves unknown and invalid expressions literally", () => {
    expect(
      expandPromptMacros("{{unknown::{{date}}}} {{time::Mars}} {{date")
    ).toBe("{{unknown::{{date}}}} {{time::Mars}} {{date")
  })

  it("accepts an omitted context without throwing", () => {
    expect(expandPromptMacros("{{isodate}}", undefined)).toMatch(
      /^\d{4}-\d{2}-\d{2}$/
    )
  })

  it("uses a registry instead of hardcoded names", () => {
    const definitions: MacroDefinition[] = [
      {
        name: "projectName",
        evaluate: (args) => (args.length ? null : "Nibchat"),
      },
    ]
    expect(
      expandPromptMacros(
        "{{ PROJECTNAME }}",
        context,
        createMacroRegistry(definitions)
      )
    ).toBe("Nibchat")
  })

  it("finds idle duration from the user turn before the current turn", () => {
    expect(
      idleSinceFromPath([
        { role: "user", created_at: "2026-04-16T05:00:00.000Z" },
        { role: "assistant", created_at: "2026-04-16T05:01:00.000Z" },
        { role: "user", created_at: "2026-04-16T07:00:00.000Z" },
      ])?.toISOString()
    ).toBe("2026-04-16T05:00:00.000Z")
    expect(
      idleSinceFromPath([{ role: "user", created_at: "bad" }])
    ).toBeUndefined()
  })

  it("falls back to UTC for an unsupported browser zone", () => {
    expect(normalizeTimeZone("Mars/Olympus")).toBe("UTC")
  })

  it("builds picker rows from definitions, not a parallel catalog", () => {
    const entries = macroPickerEntries(builtInMacroDefinitions)
    expect(entries.map((entry) => entry.name)).toEqual(
      builtInMacroDefinitions.map((definition) => definition.name)
    )
    const catalog = catalogMacroContext("America/Bogota", context.now)
    expect(catalog.chat?.id).toBe(SAMPLE_MACRO_CHAT.id)
    for (const group of groupedMacroPickerEntries(builtInMacroDefinitions)) {
      for (const entry of group.entries) {
        if (entry.preview === "snippet") {
          expect(macroPickerPreview(entry, catalog)).toBe(entry.snippet)
          continue
        }
        expect(macroPickerPreview(entry, catalog)).not.toBe(entry.snippet)
        expect(expandPromptMacros(entry.snippet, catalog)).not.toBe(
          entry.snippet
        )
      }
    }
  })

  it("defaults the insert snippet to {{name}}", () => {
    expect(
      macroPickerEntries([{ name: "projectName", evaluate: () => "Nibchat" }])
    ).toEqual([
      {
        name: "projectName",
        summary: "projectName",
        snippet: "{{projectName}}",
        group: "time",
        preview: "value",
      },
    ])
  })
})
