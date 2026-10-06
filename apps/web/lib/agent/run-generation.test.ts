import { beforeAll, describe, expect, it, vi } from "vitest"
import { MockLanguageModelV4, simulateReadableStream } from "ai/test"
import { db, migrate } from "@/lib/db"
import { createChat, createMessage, startGeneration } from "@/lib/chat-service"
import { defaultPromptStack } from "@/lib/prompt-stack"
import { startGenerationProducer } from "./run-generation"

const { tasks } = vi.hoisted(() => ({ tasks: [] as Promise<void>[] }))
vi.mock("@/lib/generation-streams/default-port", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/generation-streams/default-port")
  >()),
  generationExecutor: {
    execute: ({ run }: { run: () => Promise<void> }) => {
      tasks.push(run())
    },
  },
}))
const userId = "generation-diagnostic-user"
beforeAll(async () => {
  await migrate()
  const now = new Date().toISOString()
  await db
    .insertInto("user")
    .values({
      id: userId,
      name: userId,
      email: `${userId}@test.local`,
      emailVerified: 1 as unknown as boolean,
      image: null,
      createdAt: now,
      updatedAt: now,
    })
    .execute()
})

type StreamPart =
  Awaited<
    ReturnType<MockLanguageModelV4["doStream"]>
  >["stream"] extends ReadableStream<infer T>
    ? T
    : never
const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
}
function model(kind: "text" | "question" | "limit" | "error") {
  const chunks: StreamPart[] = [{ type: "stream-start", warnings: [] }]
  if (kind === "text")
    chunks.push(
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Private answer" },
      { type: "text-end", id: "t" }
    )
  if (kind === "question")
    chunks.push({
      type: "tool-call",
      toolCallId: "question-1",
      toolName: "question",
      input: JSON.stringify({
        questions: [
          {
            question: "Private question?",
            header: "Choice",
            options: [
              { label: "A", description: "" },
              { label: "B", description: "" },
            ],
          },
        ],
      }),
    })
  if (kind === "error")
    chunks.push({
      type: "error",
      error: new Error("Private provider response"),
    })
  chunks.push({
    type: "finish",
    finishReason: {
      unified: kind === "question" || kind === "limit" ? "tool-calls" : "stop",
      raw: "test",
    },
    usage,
  })
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream<StreamPart>({
        chunks,
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
    }),
  })
}
async function run(
  kind: "text" | "question" | "limit" | "error",
  externalAbort?: AbortSignal
) {
  const chat = await createChat(userId)
  const request = await createMessage({
    userId,
    chatId: chat.id,
    parentId: null,
    role: "user",
    parts: [{ type: "text", text: "Private input" }],
    attachSelection: true,
  })
  const generationId = crypto.randomUUID()
  const { assistant } = await startGeneration({
    userId,
    chatId: chat.id,
    parentId: request.id,
    generationId,
  })
  const allNodes = await db
    .selectFrom("message_nodes")
    .selectAll()
    .where("chat_id", "=", chat.id)
    .execute()
  await startGenerationProducer({
    userId,
    assistant,
    contextLeafId: request.id,
    config: { model: "test-model" },
    languageModel: model(kind),
    promptStack: defaultPromptStack(),
    timeZone: "UTC",
    allNodes,
    generationId,
    maxSteps: 1,
    externalAbort,
  })
  await Promise.all(tasks.splice(0))
  const operation = await db
    .selectFrom("diagnostic_operations")
    .selectAll()
    .where("id", "=", generationId)
    .executeTakeFirstOrThrow()
  const events = await db
    .selectFrom("diagnostic_events")
    .selectAll()
    .where("operation_id", "=", generationId)
    .execute()
  return { operation, metadata: JSON.parse(operation.metadata_json), events }
}

describe("generation diagnostic triggers", () => {
  it("records completion, usage and first content without conversation text", async () => {
    const result = await run("text")
    expect(result.operation.outcome).toBe("complete")
    expect(result.metadata).toMatchObject({
      usage: { inputTokens: 3, outputTokens: 2 },
      firstContentMs: expect.any(Number),
    })
    expect(result.events.map((row) => row.event)).toEqual([
      "operation.started",
      "operation.finished",
    ])
    expect(JSON.stringify(result)).not.toContain("Private")
  })
  it("records client input requests and an awaiting-input outcome", async () => {
    const result = await run("question")
    expect(result.operation.outcome).toBe("awaiting_input")
    expect(
      result.events.filter((row) => row.event === "tool.requested")
    ).toHaveLength(1)
    expect(
      result.events.filter((row) => row.event === "tool.started")
    ).toHaveLength(0)
    expect(JSON.stringify(result)).not.toContain("Private question")
  })
  it("records a model step-limit reason", async () => {
    const result = await run("limit")
    expect(result.operation.outcome).toBe("error")
    expect(result.metadata).toMatchObject({
      reason: "step_limit",
      phase: "model",
    })
  })
  it("records stream errors with one terminal event", async () => {
    const result = await run("error")
    expect(result.operation.outcome).toBe("error")
    expect(result.metadata).toMatchObject({
      reason: "stream_failed",
      phase: "stream",
      errorType: "Error",
    })
    expect(
      result.events.filter((row) => row.event === "operation.finished")
    ).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain("Private provider response")
  })
  it("records explicit external cancellation", async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await run("text", controller.signal)
    expect(result.operation.outcome).toBe("cancelled")
  })
})
