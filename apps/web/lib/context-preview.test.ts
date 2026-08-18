import { describe, expect, it } from "vitest"
import type { ModelMessage } from "ai"
import type { NodeRow, Parts } from "@/lib/types"
import {
  assembleContextPreview,
  estimateTokens,
  formatCompactNumber,
  formatCompactSegments,
  mergeDraftSummary,
  summarizeAssembledContext,
  TOKEN_ESTIMATE_TOOLTIP,
} from "@/lib/context-preview"
import {
  assemblePromptContext,
  defaultPromptStack,
  normalizePromptStack,
  type AssembledTurn,
  type PromptStackDocument,
  type StackModule,
} from "@/lib/prompt-stack"

function node(
  id: string,
  role: NodeRow["role"],
  parts: Parts,
  extra?: Partial<NodeRow>
): NodeRow {
  return {
    id,
    chat_id: "c",
    parent_id: null,
    selected_child_id: null,
    role,
    parts_json: JSON.stringify(parts),
    search_text: "",
    metadata_json: "{}",
    excluded_from_context: false,
    status: "complete",
    created_at: "",
    updated_at: "",
    ...extra,
  }
}

function userText(text: string): ModelMessage {
  return { role: "user", content: [{ type: "text", text }] }
}

function pathTurn(text: string): AssembledTurn {
  return { source: "path", message: userText(text) }
}

function stackTurn(content: string): AssembledTurn {
  return { source: "stack", message: { role: "user", content } }
}

function stackDoc(modules: StackModule[]): PromptStackDocument {
  return normalizePromptStack({ modules })
}

describe("context preview helpers", () => {
  it("estimates tokens as chars/4", () => {
    expect(estimateTokens(0)).toBe(0)
    expect(estimateTokens(4)).toBe(1)
    expect(estimateTokens(5)).toBe(2)
  })

  it("formats compact counts", () => {
    expect(formatCompactNumber(12)).toBe("12")
    expect(formatCompactNumber(2100)).toBe("2.1k")
    expect(formatCompactNumber(8400)).toBe("8.4k")
    expect(formatCompactNumber(40_000)).toBe("40k")
  })

  it("counts path messages after exclusions and lists excluded nodes", () => {
    const result = summarizeAssembledContext({
      system: "You are a helpful assistant.",
      turns: [pathTurn("keep")],
      historyEnabled: true,
      replayReasoning: false,
      contextNodes: [
        node("u1", "user", [{ type: "text", text: "keep" }]),
        node("a1", "assistant", [{ type: "text", text: "omit this" }], {
          excluded_from_context: true,
        }),
      ],
    })
    expect(result.summary.messageCount).toBe(1)
    expect(result.summary.excludedCount).toBe(1)
    expect(result.excludedMessages).toEqual([
      { id: "a1", role: "assistant", preview: "omit this" },
    ])
    expect(result.extraWarnings.map((w) => w.message)).toContain(
      "1 message excluded from context"
    )
    expect(result.summary.charCount).toBe(
      "You are a helpful assistant.".length + "keep".length
    )
    expect(result.summary.estimatedTokens).toBe(
      estimateTokens(result.summary.charCount)
    )
  })

  it("attributes stack vs path from assembled turns, not length subtraction", () => {
    const result = summarizeAssembledContext({
      system: "sys",
      turns: [stackTurn("in-chat module"), pathTurn("hi")],
      historyEnabled: true,
      replayReasoning: false,
      contextNodes: [node("u1", "user", [{ type: "text", text: "hi" }])],
    })
    expect(result.summary.layers.map((l) => l.id)).toEqual(["stack", "path"])
    const stack = result.summary.layers[0]!
    const path = result.summary.layers[1]!
    expect(stack.charCount).toBe("sys".length + "in-chat module".length)
    expect(stack.messageCount).toBe(1)
    expect(path.messageCount).toBe(1)
    expect(path.charCount).toBe("hi".length)
    expect(result.summary.messageCount).toBe(2)
  })

  it("ignores path nodes when history is disabled", () => {
    const assembled = assemblePromptContext({
      pathMessages: [userText("keep"), userText("also")],
      stack: stackDoc([
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
    const result = summarizeAssembledContext({
      system: assembled.system,
      turns: assembled.turns,
      historyEnabled: assembled.historyEnabled,
      replayReasoning: false,
      contextNodes: [
        node("u1", "user", [{ type: "text", text: "keep" }]),
        node("a1", "assistant", [{ type: "text", text: "omit this" }], {
          excluded_from_context: true,
        }),
        node("u2", "user", [
          {
            type: "attachment",
            id: "img1",
            name: "photo.png",
            source: { kind: "upload" },
            content: {
              kind: "binary",
              attachmentId: "att-1",
              mediaType: "image/png",
              byteSize: 4,
              sha256: "a".repeat(64),
            },
          },
        ]),
      ],
    })
    expect(assembled.historyEnabled).toBe(false)
    expect(result.summary.messageCount).toBe(1)
    expect(
      result.summary.layers.find((l) => l.id === "stack")?.messageCount
    ).toBe(1)
    expect(result.summary.excludedCount).toBe(0)
    expect(result.summary.imageCount).toBe(0)
    expect(result.summary.charCount).toBe("sys".length + "tail".length)
    expect(result.summary.layers.find((l) => l.id === "path")?.charCount).toBe(
      0
    )
    expect(result.summary.layers.find((l) => l.id === "stack")?.charCount).toBe(
      "sys".length + "tail".length
    )
    expect(result.extraWarnings.map((w) => w.message)).toContain(
      "Chat history is disabled for this stack"
    )
    expect(result.extraWarnings.map((w) => w.message)).not.toContain(
      "1 message excluded from context"
    )
  })

  it("counts image attachments on included path nodes only", () => {
    const result = summarizeAssembledContext({
      system: "",
      turns: [
        {
          source: "path",
          message: {
            role: "user",
            content: [{ type: "text", text: "[Image attachment: photo.png]" }],
          },
        },
      ],
      historyEnabled: true,
      replayReasoning: false,
      contextNodes: [
        node("u1", "user", [
          {
            type: "attachment",
            id: "img1",
            name: "photo.png",
            source: { kind: "upload" },
            content: {
              kind: "binary",
              attachmentId: "att-1",
              mediaType: "image/png",
              byteSize: 4,
              sha256: "a".repeat(64),
            },
          },
        ]),
        node(
          "u2",
          "user",
          [
            {
              type: "attachment",
              id: "img2",
              name: "skipped.png",
              source: { kind: "upload" },
              content: {
                kind: "binary",
                attachmentId: "att-2",
                mediaType: "image/png",
                byteSize: 4,
                sha256: "b".repeat(64),
              },
            },
          ],
          { excluded_from_context: true }
        ),
      ],
    })
    expect(result.summary.imageCount).toBe(1)
    expect(result.summary.attachmentCount).toBe(1)
    expect(result.summary.charCount).toBe(
      "[Image attachment: photo.png]".length
    )
  })

  it("warns when owner-edited reasoning would be dropped", () => {
    const result = summarizeAssembledContext({
      system: "",
      turns: [],
      historyEnabled: true,
      replayReasoning: true,
      contextNodes: [
        node(
          "a1",
          "assistant",
          [
            { type: "reasoning", text: "secret scratch" },
            { type: "text", text: "visible" },
          ],
          { metadata_json: JSON.stringify({ provenance: "owner-edited" }) }
        ),
      ],
    })
    expect(result.extraWarnings.map((w) => w.message)).toContain(
      "Reasoning replay disabled for edited branches"
    )
  })

  it("does not warn about edited reasoning when replay is already off", () => {
    const result = summarizeAssembledContext({
      system: "",
      turns: [],
      historyEnabled: true,
      replayReasoning: false,
      contextNodes: [
        node(
          "a1",
          "assistant",
          [
            { type: "reasoning", text: "secret scratch" },
            { type: "text", text: "visible" },
          ],
          { metadata_json: JSON.stringify({ provenance: "owner-edited" }) }
        ),
      ],
    })
    expect(result.extraWarnings.map((w) => w.message)).not.toContain(
      "Reasoning replay disabled for edited branches"
    )
  })

  it("merges draft chars without treating images as tokens", () => {
    const base = summarizeAssembledContext({
      system: "sys",
      turns: [],
      historyEnabled: true,
      replayReasoning: false,
      contextNodes: [],
    }).summary
    const merged = mergeDraftSummary(base, {
      text: "hello",
      attachments: [
        { name: "shot.png", reference: { kind: "uploaded-file" } },
        { name: "notes", reference: { kind: "mcp-resource" } },
      ],
    })
    expect(merged.charCount).toBe(base.charCount + 5)
    expect(merged.estimatedTokens).toBe(estimateTokens(merged.charCount))
    expect(merged.imageCount).toBe(1)
    expect(merged.attachmentCount).toBe(2)
    const draft = merged.layers.find((l) => l.id === "draft")
    expect(draft?.charCount).toBe(5)
    expect(draft?.messageCount).toBe(1)
  })

  it("leaves summary unchanged when the draft is empty", () => {
    const base = summarizeAssembledContext({
      system: "sys",
      turns: [],
      historyEnabled: true,
      replayReasoning: false,
      contextNodes: [],
    }).summary
    expect(mergeDraftSummary(base, { text: "", attachments: [] })).toBe(base)
  })

  it("omits zero exclusion segments and labels the token estimate", () => {
    const summary = summarizeAssembledContext({
      system: "sys",
      turns: [pathTurn("hi")],
      historyEnabled: true,
      replayReasoning: false,
      contextNodes: [node("u1", "user", [{ type: "text", text: "hi" }])],
    }).summary
    const segments = formatCompactSegments(summary)
    expect(segments.map((s) => s.text).join(" · ")).not.toContain("excluded")
    expect(segments.some((s) => s.text.endsWith("tokens (est.)"))).toBe(true)
    expect(
      segments.find((s) => s.text.endsWith("tokens (est.)"))?.tooltip
    ).toBe(TOKEN_ESTIMATE_TOOLTIP)
  })

  it("uses a stack-only label when the path is empty", () => {
    const summary = summarizeAssembledContext({
      system: "sys",
      turns: [],
      historyEnabled: true,
      replayReasoning: false,
      contextNodes: [],
    }).summary
    expect(formatCompactSegments(summary)[0]?.text).toBe("System + 0 messages")
  })
})

describe("assembleContextPreview", () => {
  it("resolves the instance default stack with no chat path", () => {
    const preview = assembleContextPreview({
      nodes: [],
      contextParentId: null,
      chatStackId: null,
      defaultStackId: "def",
      stacks: [{ id: "def", stack: defaultPromptStack() }],
      replayReasoning: false,
    })
    expect(preview.source).toBe("instance")
    expect(preview.stackId).toBe("def")
    expect(preview.system).toContain("helpful assistant")
    expect(preview.summary.messageCount).toBe(0)
    expect(preview.summary.charCount).toBe(preview.system.length)
  })

  it("walks ancestors of the composer parent, not an unrelated selected tip", () => {
    const root = node("u1", "user", [{ type: "text", text: "root" }])
    const side = node("u-side", "user", [{ type: "text", text: "branch" }], {
      parent_id: "u1",
    })
    const preview = assembleContextPreview({
      nodes: [root, side],
      contextParentId: "u-side",
      chatStackId: null,
      defaultStackId: "def",
      stacks: [{ id: "def", stack: defaultPromptStack() }],
      replayReasoning: false,
    })
    expect(
      preview.summary.layers.find((l) => l.id === "path")?.messageCount
    ).toBe(2)
    expect(preview.summary.charCount).toBeGreaterThan(preview.system.length)
  })

  it("counts exclusions on the composer path", () => {
    const keep = node("u1", "user", [{ type: "text", text: "keep" }])
    const omitted = node(
      "a1",
      "assistant",
      [{ type: "text", text: "omit this" }],
      {
        parent_id: "u1",
        excluded_from_context: true,
      }
    )
    const cont = node("u2", "user", [{ type: "text", text: "continue" }], {
      parent_id: "a1",
    })
    const preview = assembleContextPreview({
      nodes: [keep, omitted, cont],
      contextParentId: "u2",
      chatStackId: "bound",
      defaultStackId: "def",
      stacks: [
        {
          id: "bound",
          stack: stackDoc([
            {
              id: "s",
              kind: "prompt",
              name: "Sys",
              enabled: true,
              body: "Bound stack body",
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
        },
      ],
      replayReasoning: false,
    })
    expect(preview.source).toBe("chat")
    expect(preview.system).toContain("Bound stack body")
    expect(preview.summary.excludedCount).toBe(1)
    expect(
      preview.summary.layers.find((l) => l.id === "path")?.messageCount
    ).toBe(2)
    expect(preview.excludedMessages).toEqual([
      expect.objectContaining({ id: "a1", role: "assistant" }),
    ])
  })

  it("includes MCP initialize instructions when the module is enabled", () => {
    const preview = assembleContextPreview({
      nodes: [],
      contextParentId: null,
      chatStackId: null,
      defaultStackId: "def",
      stacks: [{ id: "def", stack: defaultPromptStack() }],
      replayReasoning: false,
      mcpServerInstructionsText: "MCP server “demo”:\nUse carefully",
    })
    expect(preview.system).toContain("Use carefully")
    expect(preview.summary.charCount).toBe(preview.system.length)
  })

  it("uses an explicit stack id as the chat stack", () => {
    const preview = assembleContextPreview({
      nodes: [],
      contextParentId: null,
      chatStackId: "picked",
      defaultStackId: "def",
      stacks: [
        { id: "def", stack: defaultPromptStack() },
        {
          id: "picked",
          stack: stackDoc([
            {
              id: "s",
              kind: "prompt",
              name: "Sys",
              enabled: true,
              body: "picked body",
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
        },
      ],
      replayReasoning: false,
    })
    expect(preview.source).toBe("chat")
    expect(preview.system).toContain("picked body")
  })

  it("reports a missing stack once the catalog is loaded", () => {
    const preview = assembleContextPreview({
      nodes: [],
      contextParentId: null,
      chatStackId: "gone",
      defaultStackId: "def",
      stacks: [{ id: "def", stack: defaultPromptStack() }],
      replayReasoning: false,
    })
    expect(preview.missingStackId).toBe("gone")
    expect(preview.source).toBe("fallback")
  })
})
