import { describe, expect, it } from "vitest"
import { defaultMacroContext } from "@/lib/prompt-macros"
import {
  defaultContextBook,
  resolveContextEntries,
  type ContextBookSource,
} from "@/lib/context-books"

function source(
  entries: ContextBookSource["book"]["entries"],
  tokenBudget: number | null = null
): ContextBookSource {
  return {
    id: "book-1",
    name: "Test book",
    source: "chat",
    book: { ...defaultContextBook(), tokenBudget, entries },
  }
}
function match(
  overrides: Partial<ContextBookSource["book"]["entries"][number]> = {}
): ContextBookSource["book"]["entries"][number] {
  return {
    id: "entry-1",
    title: "Entry",
    enabled: true,
    content: "Remember this",
    namespace: "default",
    priority: 100,
    activation: {
      kind: "match",
      keywords: ["Nibchat"],
      match: "any",
      secondary: [],
      secondaryMatch: "any",
      caseSensitive: false,
      wholeWord: true,
    },
    ...overrides,
  }
}

describe("resolveContextEntries", () => {
  it("uses chat depth unless an entry overrides it, including the entire branch", () => {
    const entry = match()
    if (entry.activation.kind !== "match") throw new Error("Expected match")
    const messages = [
      { role: "user" as const, text: "Nibchat" },
      { role: "assistant" as const, text: "unrelated" },
      { role: "user" as const, text: "more" },
    ]
    const resolve = (scanDepth: number | null) =>
      resolveContextEntries({ books: [source([entry])], messages, scanDepth })
    expect(resolve(3).decisions[0]?.status).toBe("included")
    expect(resolve(1).decisions[0]?.status).toBe("unmatched")
    entry.activation.scanMessages = null
    expect(resolve(1).decisions[0]?.status).toBe("included")
  })

  it("matches literal whole words without case sensitivity", () => {
    const result = resolveContextEntries({
      books: [source([match()])],
      messages: [{ role: "user", text: "Tell me about nibchat." }],
    })
    expect(result.namespaces.default).toBe("Remember this")
    expect(result.decisions[0]?.status).toBe("included")
    const partial = resolveContextEntries({
      books: [source([match()])],
      messages: [{ role: "user", text: "nibchatter" }],
    })
    expect(partial.namespaces.default).toBeUndefined()
  })

  it("selects higher priority entries first without splitting entries", () => {
    const low = match({
      id: "low",
      content: "l".repeat(40),
      priority: 1,
      activation: { kind: "always" },
    })
    const high = match({
      id: "high",
      content: "h".repeat(40),
      priority: 10,
      activation: { kind: "always" },
    })
    const result = resolveContextEntries({
      books: [source([low, high], 10)],
      messages: [],
    })
    expect(result.namespaces.default).toBe("h".repeat(40))
    expect(
      result.decisions.find((item) => item.entryId === "low")?.status
    ).toBe("budget")
  })

  it("expands regular macros and rejects context recursion", () => {
    const result = resolveContextEntries({
      books: [
        source([
          match({ activation: { kind: "always" }, content: "{{vars.name}}" }),
          match({
            id: "recursive",
            activation: { kind: "always" },
            content: "{{contextEntries}}",
          }),
        ]),
      ],
      messages: [],
      macroContext: defaultMacroContext({ variables: { name: "Ada" } }),
    })
    expect(result.namespaces.default).toBe("Ada")
    expect(
      result.decisions.find((item) => item.entryId === "recursive")?.status
    ).toBe("invalid")
  })
})
