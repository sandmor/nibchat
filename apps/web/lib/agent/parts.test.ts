import { describe, expect, it } from "vitest"
import {
  allPendingResultsReady,
  applyToolOutputs,
  hasToolInvocations,
  partsHavePendingClientTools,
  pendingToolInvocations,
  resolveStreamTerminalOutcome,
  searchTextFromParts,
  textFromParts,
  upsertToolInvocation,
} from "@/lib/agent/parts"
import { buildModelMessages } from "@/lib/agent/build-messages"
import {
  formatQuestionResult,
  validateQuestionAnswers,
} from "@/lib/agent/tools/question-shared"
import type { NodeRow, Parts } from "@/lib/types"

const questions = [
  {
    question: "Which approach?",
    header: "Approach",
    options: [
      { label: "A (Recommended)", description: "Do A" },
      { label: "B", description: "Do B" },
    ],
    multiple: false,
    custom: true,
  },
  {
    question: "What checks?",
    header: "Checks",
    options: [
      { label: "Tests", description: "Run tests" },
      { label: "Types", description: "Run types" },
    ],
    multiple: true,
    custom: false,
  },
]

describe("formatQuestionResult", () => {
  it("formats title and summary for answered questions", () => {
    const result = formatQuestionResult(questions, [
      ["A (Recommended)"],
      ["Tests", "Types"],
    ])
    expect(result.title).toBe("Asked 2 questions")
    expect(result.output).toContain('"Which approach?"="A (Recommended)"')
    expect(result.output).toContain('"What checks?"="Tests, Types"')
    expect(result.metadata.answers).toEqual([
      ["A (Recommended)"],
      ["Tests", "Types"],
    ])
  })

  it("uses Unanswered for empty selections", () => {
    const result = formatQuestionResult(questions, [[], []])
    expect(result.output).toContain("Unanswered")
  })
})

describe("validateQuestionAnswers", () => {
  const input = { questions }

  it("accepts valid single and multi selections", () => {
    const ok = validateQuestionAnswers(input, [["B"], ["Tests"]])
    expect(ok).toEqual({ ok: true, answers: [["B"], ["Tests"]] })
  })

  it("allows freeform when custom is true", () => {
    const ok = validateQuestionAnswers(input, [["Something else"], ["Tests"]])
    expect(ok.ok).toBe(true)
  })

  it("rejects freeform when custom is false", () => {
    const bad = validateQuestionAnswers(input, [["A (Recommended)"], ["Other"]])
    expect(bad.ok).toBe(false)
  })

  it("rejects multi when multiple is false", () => {
    const bad = validateQuestionAnswers(input, [
      ["A (Recommended)", "B"],
      ["Tests"],
    ])
    expect(bad.ok).toBe(false)
  })

  it("allows empty answer groups (skip / unanswered)", () => {
    const ok = validateQuestionAnswers(input, [[], []])
    expect(ok).toEqual({ ok: true, answers: [[], []] })
    const partial = validateQuestionAnswers(input, [["B"], []])
    expect(partial).toEqual({ ok: true, answers: [["B"], []] })
  })
})

describe("parts helpers", () => {
  it("indexes tools and prose in search text but not reasoning", () => {
    const parts: Parts = [
      { type: "reasoning", text: "secret" },
      { type: "text", text: "hello" },
      {
        type: "tool-invocation",
        toolCallId: "t1",
        toolName: "question",
        state: "input-available",
        input: { questions: [{ header: "Scope" }] },
      },
    ]
    expect(textFromParts(parts)).toBe("hello")
    expect(searchTextFromParts(parts)).toContain("hello")
    expect(searchTextFromParts(parts)).toContain("question: Scope")
    expect(searchTextFromParts(parts)).not.toContain("secret")
  })

  it("tracks pending tools and applies outputs", () => {
    let parts: Parts = [
      {
        type: "tool-invocation",
        toolCallId: "c1",
        toolName: "question",
        state: "input-available",
        input: { questions },
      },
    ]
    expect(partsHavePendingClientTools(parts)).toBe(true)
    parts = applyToolOutputs(parts, [
      { toolCallId: "c1", output: { title: "Asked 1 question", output: "ok" } },
    ])
    expect(partsHavePendingClientTools(parts)).toBe(false)
    expect(hasToolInvocations(parts)).toBe(true)
    expect(parts[0]).toMatchObject({
      state: "output-available",
      output: { title: "Asked 1 question", output: "ok" },
    })
  })

  it("treats only input-available as pending (not mid-stream stubs)", () => {
    const streaming: Parts = [
      {
        type: "tool-invocation",
        toolCallId: "c1",
        toolName: "question",
        state: "input-streaming",
        input: {},
      },
    ]
    expect(partsHavePendingClientTools(streaming)).toBe(false)
    expect(resolveStreamTerminalOutcome("aborted", streaming)).toBe("aborted")
    expect(pendingToolInvocations(streaming)).toEqual([])

    const available: Parts = [
      {
        type: "tool-invocation",
        toolCallId: "c1",
        toolName: "question",
        state: "input-available",
        input: { questions },
      },
    ]
    expect(partsHavePendingClientTools(available)).toBe(true)
    expect(resolveStreamTerminalOutcome("aborted", available)).toBe(
      "awaiting_input"
    )
  })

  it("reports when all pending results are ready", () => {
    expect(allPendingResultsReady(["a", "b"], { a: 1 })).toBe(false)
    expect(allPendingResultsReady(["a", "b"], { a: 1, b: 2 })).toBe(true)
    expect(allPendingResultsReady([], {})).toBe(false)
    expect(allPendingResultsReady(["a"], { a: [] })).toBe(true)
  })

  it("upserts tool invocations by id", () => {
    let parts: Parts = []
    parts = upsertToolInvocation(parts, {
      type: "tool-invocation",
      toolCallId: "c1",
      toolName: "question",
      state: "input-streaming",
      input: {},
    })
    parts = upsertToolInvocation(parts, {
      type: "tool-invocation",
      toolCallId: "c1",
      toolName: "question",
      state: "input-available",
      input: { questions },
    })
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ state: "input-available" })
  })

  it("promotes aborted/complete to awaiting_input when client tools are pending", () => {
    const pending: Parts = [
      {
        type: "tool-invocation",
        toolCallId: "c1",
        toolName: "question",
        state: "input-available",
        input: { questions },
      },
    ]
    expect(resolveStreamTerminalOutcome("aborted", pending)).toBe(
      "awaiting_input"
    )
    expect(resolveStreamTerminalOutcome("complete", pending)).toBe(
      "awaiting_input"
    )
    expect(resolveStreamTerminalOutcome("error", pending)).toBe("error")
    expect(
      resolveStreamTerminalOutcome("aborted", [{ type: "text", text: "hi" }])
    ).toBe("aborted")
  })
})

describe("buildModelMessages", () => {
  function node(
    id: string,
    role: NodeRow["role"],
    parts: Parts,
    status: NodeRow["status"] = "complete"
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
      status,
      created_at: "",
      updated_at: "",
    }
  }

  it("expands completed tool rounds into assistant + tool messages", () => {
    const messages = buildModelMessages({
      nodes: [
        node("u1", "user", [{ type: "text", text: "hi" }]),
        node("a1", "assistant", [
          { type: "text", text: "Need a choice." },
          {
            type: "tool-invocation",
            toolCallId: "c1",
            toolName: "question",
            state: "output-available",
            input: { questions },
            output: formatQuestionResult(questions, [["B"], ["Tests"]]),
          },
          { type: "text", text: "Going with B." },
        ]),
      ],
      replayReasoning: false,
    })

    expect(messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ])
    const toolMsg = messages[2]
    expect(toolMsg?.role).toBe("tool")
    if (toolMsg?.role === "tool") {
      expect(toolMsg.content[0]).toMatchObject({
        type: "tool-result",
        toolCallId: "c1",
      })
    }
  })

  it("emits pending tool calls without tool results", () => {
    const messages = buildModelMessages({
      nodes: [
        node("a1", "assistant", [
          {
            type: "tool-invocation",
            toolCallId: "c1",
            toolName: "question",
            state: "input-available",
            input: { questions },
          },
        ]),
      ],
      replayReasoning: false,
    })
    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe("assistant")
  })
})
