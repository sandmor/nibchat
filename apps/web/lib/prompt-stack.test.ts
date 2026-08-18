import { describe, expect, it } from "vitest"
import type { ModelMessage } from "ai"
import {
  assemblePromptContext,
  defaultPromptStack,
  findSystemAfterNonSystemWarnings,
  HISTORY_MODULE_NAME,
  normalizePromptStack,
  promptStackToJson,
  readStackJson,
  requirePromptStack,
  resolvePromptStack,
  type PromptStackDocument,
  type StackModule,
} from "@/lib/prompt-stack"

const path: ModelMessage[] = [
  { role: "user", content: "u1" },
  { role: "assistant", content: "a1" },
  { role: "user", content: "u2" },
]

function stack(modules: StackModule[]): PromptStackDocument {
  return normalizePromptStack({ modules })
}

function contentOf(msg: ModelMessage): string {
  if (typeof msg.content === "string") return msg.content
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((part) =>
        typeof part === "object" && part && "text" in part
          ? String((part as { text: string }).text)
          : ""
      )
      .join("")
  }
  return ""
}

describe("requirePromptStack", () => {
  it("throws for invalid input", () => {
    expect(() => requirePromptStack(null)).toThrow(/Invalid prompt stack/)
    expect(() => requirePromptStack({})).toThrow(/Invalid prompt stack/)
    expect(() => requirePromptStack("nope")).toThrow(/Invalid prompt stack/)
  })

  it("empty modules still normalize with MCP server instructions and history", () => {
    const parsed = requirePromptStack({ modules: [] })
    expect(parsed.modules.map((module) => module.kind)).toEqual([
      "mcp-instructions",
      "history",
    ])
  })

  it("accepts valid documents and ensures history", () => {
    const doc = stack([
      {
        id: "m1",
        kind: "prompt",
        name: "A",
        enabled: true,
        body: "hello",
        placement: "relative",
        role: "system",
      },
      {
        id: "h",
        kind: "history",
        name: "Chat history",
        enabled: true,
      },
    ])
    expect(requirePromptStack(doc)).toEqual(doc)
  })

  it("injects history when missing", () => {
    const parsed = requirePromptStack({
      modules: [
        {
          id: "m1",
          kind: "prompt",
          name: "A",
          enabled: true,
          body: "x",
          placement: "relative",
          role: "system",
        },
      ],
    })
    expect(parsed.modules.some((m) => m.kind === "history")).toBe(true)
  })
})

describe("invariants", () => {
  it("throws when more than one history module", () => {
    expect(() =>
      normalizePromptStack({
        modules: [
          {
            id: "h1",
            kind: "history",
            name: "Chat history",
            enabled: true,
          },
          {
            id: "h2",
            kind: "history",
            name: "Chat history",
            enabled: true,
          },
        ],
      })
    ).toThrow(/exactly one history/)
  })

  it("forces history name to canonical label", () => {
    const doc = requirePromptStack({
      modules: [
        {
          id: "h",
          kind: "history",
          name: "Alias",
          enabled: true,
        },
      ],
    })
    expect(
      doc.modules.find((module) => module.kind === "history")
    ).toMatchObject({
      kind: "history",
      name: HISTORY_MODULE_NAME,
    })
  })

  it("strips depth on relative and defaults depth on in_chat", () => {
    const doc = requirePromptStack({
      modules: [
        {
          id: "r",
          kind: "prompt",
          name: "R",
          enabled: true,
          body: "a",
          placement: "relative",
          depth: 3,
          role: "system",
        },
        {
          id: "i",
          kind: "prompt",
          name: "I",
          enabled: true,
          body: "b",
          placement: "in_chat",
          role: "user",
        },
        {
          id: "h",
          kind: "history",
          name: "Chat history",
          enabled: true,
        },
      ],
    })
    const rel = doc.modules.find((m) => m.id === "r")
    const inj = doc.modules.find((m) => m.id === "i")
    expect(rel?.kind).toBe("prompt")
    if (rel?.kind === "prompt") {
      expect(rel.placement).toBe("relative")
      expect(rel.depth).toBeUndefined()
    }
    expect(inj?.kind).toBe("prompt")
    if (inj?.kind === "prompt") {
      expect(inj.depth).toBe(0)
    }
  })

  it("readStackJson rejects corrupt JSON and bad docs", () => {
    expect(() => readStackJson("{")).toThrow(/Invalid prompt stack/)
    expect(() => readStackJson(JSON.stringify({ modules: "no" }))).toThrow(
      /Invalid prompt stack/
    )
    expect(
      readStackJson(promptStackToJson(defaultPromptStack())).modules[0]?.kind
    ).toBe("prompt")
  })
})

describe("assemblePromptContext", () => {
  it("peels leading system relative into system string", () => {
    const result = assemblePromptContext({
      pathMessages: path,
      stack: stack([
        {
          id: "s1",
          kind: "prompt",
          name: "One",
          enabled: true,
          body: "A",
          placement: "relative",
          role: "system",
        },
        {
          id: "s2",
          kind: "prompt",
          name: "Two",
          enabled: false,
          body: "B",
          placement: "relative",
          role: "system",
        },
        {
          id: "s3",
          kind: "prompt",
          name: "Three",
          enabled: true,
          body: "  ",
          placement: "relative",
          role: "system",
        },
        {
          id: "s4",
          kind: "prompt",
          name: "Four",
          enabled: true,
          body: "C",
          placement: "relative",
          role: "system",
        },
        {
          id: "h",
          kind: "history",
          name: "Chat history",
          enabled: true,
        },
      ]),
    })
    expect(result.system).toBe("A\n\nC")
    expect(result.messages.map(contentOf)).toEqual(["u1", "a1", "u2"])
  })

  it("emits relative modules around history in stack order", () => {
    const result = assemblePromptContext({
      pathMessages: path,
      stack: stack([
        {
          id: "pre",
          kind: "prompt",
          name: "Pre",
          enabled: true,
          body: "pre",
          placement: "relative",
          role: "user",
        },
        {
          id: "h",
          kind: "history",
          name: "Chat history",
          enabled: true,
        },
        {
          id: "post",
          kind: "prompt",
          name: "Post",
          enabled: true,
          body: "post",
          placement: "relative",
          role: "user",
        },
      ]),
    })
    expect(result.system).toBe("")
    expect(result.messages.map(contentOf)).toEqual([
      "pre",
      "u1",
      "a1",
      "u2",
      "post",
    ])
  })

  it("omits path and ignores in_chat when history is disabled", () => {
    const result = assemblePromptContext({
      pathMessages: path,
      stack: stack([
        {
          id: "s",
          kind: "prompt",
          name: "S",
          enabled: true,
          body: "sys",
          placement: "relative",
          role: "system",
        },
        {
          id: "h",
          kind: "history",
          name: "Chat history",
          enabled: false,
        },
        {
          id: "inj",
          kind: "prompt",
          name: "Inj",
          enabled: true,
          body: "injected",
          placement: "in_chat",
          depth: 0,
          role: "system",
        },
        {
          id: "after",
          kind: "prompt",
          name: "After",
          enabled: true,
          body: "tail",
          placement: "relative",
          role: "user",
        },
      ]),
    })
    expect(result.system).toBe("sys")
    expect(result.messages.map(contentOf)).toEqual(["tail"])
    expect(result.turns.map((turn) => turn.source)).toEqual(["stack"])
    expect(result.historyEnabled).toBe(false)
  })

  it("inserts in_chat by depth from the end of history", () => {
    const result = assemblePromptContext({
      pathMessages: path,
      stack: stack([
        {
          id: "h",
          kind: "history",
          name: "Chat history",
          enabled: true,
        },
        {
          id: "r0",
          kind: "prompt",
          name: "Depth0",
          enabled: true,
          body: "d0",
          placement: "in_chat",
          depth: 0,
          role: "system",
        },
        {
          id: "r1",
          kind: "prompt",
          name: "Depth1",
          enabled: true,
          body: "d1",
          placement: "in_chat",
          depth: 1,
          role: "system",
        },
      ]),
    })
    expect(result.messages.map(contentOf)).toEqual([
      "u1",
      "a1",
      "d1",
      "u2",
      "d0",
    ])
    expect(result.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "assistant",
      "user",
      "assistant",
    ])
    expect(result.turns.map((turn) => turn.source)).toEqual([
      "path",
      "path",
      "stack",
      "path",
      "stack",
    ])
    expect(result.historyEnabled).toBe(true)
    expect(result.demotedModuleIds).toEqual(
      expect.arrayContaining(["r0", "r1"])
    )
    expect(result.warnings.map((w) => w.moduleId)).toEqual(
      expect.arrayContaining(["r0", "r1"])
    )
  })

  it("preserves stack order for same in_chat depth", () => {
    const result = assemblePromptContext({
      pathMessages: [{ role: "user", content: "only" }],
      stack: stack([
        {
          id: "h",
          kind: "history",
          name: "Chat history",
          enabled: true,
        },
        {
          id: "x",
          kind: "prompt",
          name: "X",
          enabled: true,
          body: "first",
          placement: "in_chat",
          depth: 1,
          role: "user",
        },
        {
          id: "y",
          kind: "prompt",
          name: "Y",
          enabled: true,
          body: "second",
          placement: "in_chat",
          depth: 1,
          role: "user",
        },
        {
          id: "z",
          kind: "prompt",
          name: "Z",
          enabled: false,
          body: "skip",
          placement: "in_chat",
          depth: 1,
          role: "user",
        },
        {
          id: "w",
          kind: "prompt",
          name: "W",
          enabled: true,
          body: "third",
          placement: "in_chat",
          depth: 1,
          role: "user",
        },
      ]),
    })
    expect(result.messages.map(contentOf)).toEqual([
      "first",
      "second",
      "third",
      "only",
    ])
  })

  it("clamps in_chat depth beyond history length", () => {
    const result = assemblePromptContext({
      pathMessages: path,
      stack: stack([
        {
          id: "h",
          kind: "history",
          name: "Chat history",
          enabled: true,
        },
        {
          id: "r",
          kind: "prompt",
          name: "R",
          enabled: true,
          body: "early",
          placement: "in_chat",
          depth: 100,
          role: "user",
        },
      ]),
    })
    expect(contentOf(result.messages[0]!)).toBe("early")
  })

  it("demotes mid-context system and reports warnings", () => {
    const modules = stack([
      {
        id: "h",
        kind: "history",
        name: "Chat history",
        enabled: true,
      },
      {
        id: "mid",
        kind: "prompt",
        name: "Mid",
        enabled: true,
        body: "late sys",
        placement: "relative",
        role: "system",
      },
    ])
    const result = assemblePromptContext({
      pathMessages: path,
      stack: modules,
    })
    expect(result.system).toBe("")
    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: "late sys",
    })
    expect(result.demotedModuleIds).toContain("mid")
    expect(result.warnings.map((w) => w.moduleId)).toContain("mid")
    expect(
      findSystemAfterNonSystemWarnings(modules, path).map((w) => w.moduleId)
    ).toContain("mid")
  })

  it("warns relative system after history with empty path", () => {
    const modules = stack([
      {
        id: "h",
        kind: "history",
        name: "Chat history",
        enabled: true,
      },
      {
        id: "after",
        kind: "prompt",
        name: "After",
        enabled: true,
        body: "sys",
        placement: "relative",
        role: "system",
      },
    ])
    const warnings = findSystemAfterNonSystemWarnings(modules, [])
    expect(warnings.map((w) => w.moduleId)).toContain("after")
  })

  it("places MCP instructions text only when its module is enabled", () => {
    const withContext = assemblePromptContext({
      pathMessages: path,
      stack: stack([
        {
          id: "mcp-instructions",
          kind: "mcp-instructions",
          name: "MCP server instructions",
          enabled: true,
        },
        {
          id: "h",
          kind: "history",
          name: "Chat history",
          enabled: true,
        },
      ]),
      mcpServerInstructionsText: "MCP server “demo”:\nUse carefully",
    })
    expect(withContext.system).toContain("Use carefully")

    const disabled = assemblePromptContext({
      pathMessages: path,
      stack: stack([
        {
          id: "mcp-instructions",
          kind: "mcp-instructions",
          name: "MCP server instructions",
          enabled: false,
        },
        {
          id: "h",
          kind: "history",
          name: "Chat history",
          enabled: true,
        },
      ]),
      mcpServerInstructionsText: "MCP server “demo”:\nUse carefully",
    })
    expect(disabled.system ?? "").not.toContain("Use carefully")
  })
})

describe("resolvePromptStack", () => {
  const stacks = new Map<string, PromptStackDocument>([
    [
      "def",
      stack([
        {
          id: "d",
          kind: "prompt",
          name: "D",
          enabled: true,
          body: "default body",
          placement: "relative",
          role: "system",
        },
        {
          id: "h",
          kind: "history",
          name: "Chat history",
          enabled: true,
        },
      ]),
    ],
    [
      "chat",
      stack([
        {
          id: "c",
          kind: "prompt",
          name: "C",
          enabled: true,
          body: "chat body",
          placement: "relative",
          role: "system",
        },
        {
          id: "h2",
          kind: "history",
          name: "Chat history",
          enabled: true,
        },
      ]),
    ],
  ])

  it("inherits instance default when chat ref is null", () => {
    const r = resolvePromptStack({
      chatStackId: null,
      defaultStackId: "def",
      stacksById: stacks,
    })
    expect(r.source).toBe("instance")
    expect(r.stackId).toBe("def")
    expect(
      r.stack.modules.find((m) => m.kind === "prompt" && m.id === "d")
    ).toMatchObject({ body: "default body" })
  })

  it("uses chat ref when present", () => {
    const r = resolvePromptStack({
      chatStackId: "chat",
      defaultStackId: "def",
      stacksById: stacks,
    })
    expect(r.source).toBe("chat")
  })

  it("falls back when chat stack is missing", () => {
    const r = resolvePromptStack({
      chatStackId: "gone",
      defaultStackId: "def",
      stacksById: stacks,
    })
    expect(r.source).toBe("fallback")
    expect(r.missingStackId).toBe("gone")
  })

  it("uses code default when nothing is found", () => {
    const r = resolvePromptStack({
      chatStackId: "gone",
      defaultStackId: "also-gone",
      stacksById: stacks,
    })
    expect(r.source).toBe("code")
    expect(r.stack).toEqual(defaultPromptStack())
  })
})
