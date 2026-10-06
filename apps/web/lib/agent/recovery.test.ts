import { beforeAll, describe, expect, it, vi } from "vitest"
import { db, migrate, toDbBool } from "@/lib/db"
import {
  createChat,
  createMessage,
  deleteChat,
  insertNode,
  reconcileChatGenerationRuns,
} from "@/lib/chat-service"
import { startDiagnosticOperation } from "@/lib/diagnostics"
import { prepareAgentRun } from "@/lib/agent/task-run"

const { continueChatGeneration } = vi.hoisted(() => ({
  continueChatGeneration: vi.fn(async () => {}),
}))
vi.mock("@/lib/agent/open-generation", () => ({ continueChatGeneration }))

const userId = "agent-recovery-owner"

beforeAll(async () => {
  await migrate()
  const user = await db
    .selectFrom("user")
    .select("id")
    .where("id", "=", userId)
    .executeTakeFirst()
  if (user) return
  const timestamp = new Date().toISOString()
  await db
    .insertInto("user")
    .values({
      id: userId,
      name: userId,
      email: "agent-recovery@test.local",
      emailVerified: toDbBool(true),
      image: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .execute()
})

describe("agent generation recovery", () => {
  it("restarts an interrupted helper from its persisted parts", async () => {
    const parent = await createChat(userId, "Parent")
    const request = await createMessage({
      userId,
      chatId: parent.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "Do some work" }],
      attachSelection: true,
    })
    const assistant = await createMessage({
      userId,
      chatId: parent.id,
      parentId: request.id,
      role: "assistant",
      parts: [{ type: "text", text: "Delegating" }],
      attachSelection: true,
    })
    const child = await prepareAgentRun({
      userId,
      parentChatId: parent.id,
      parentNodeId: assistant.id,
      toolCallId: crypto.randomUUID(),
      task: { prompt: "Check it" },
    })
    const oldId = crypto.randomUUID()
    const shell = await insertNode({
      chatId: child.run.id,
      parentId: child.user.id,
      role: "assistant",
      parts: [{ type: "text", text: "Completed checkpoint" }],
      status: "streaming",
      generationId: oldId,
    })
    await db
      .updateTable("generation_runs")
      .set({ state: "active" })
      .where("id", "=", oldId)
      .execute()

    await startDiagnosticOperation({
      id: oldId,
      kind: "chat.reply.generate",
      context: { userId, chatId: child.run.id, generationId: oldId },
    })
    await reconcileChatGenerationRuns(child.run.id)

    const restarted = await db
      .selectFrom("generation_runs")
      .selectAll()
      .where("node_id", "=", shell.id)
      .executeTakeFirstOrThrow()
    expect(restarted.id).not.toBe(oldId)
    expect(restarted.state).toBe("starting")
    const original = await db
      .selectFrom("diagnostic_operations")
      .selectAll()
      .where("id", "=", oldId)
      .executeTakeFirstOrThrow()
    expect(original.outcome).toBe("interrupted")
    expect(JSON.parse(original.metadata_json)).toMatchObject({
      reason: "producer_lost",
      replacementGenerationId: restarted.id,
    })
    const recovery = await db
      .selectFrom("diagnostic_operations")
      .selectAll()
      .where("kind", "=", "agent.recovery")
      .where("chat_id", "=", child.run.id)
      .executeTakeFirstOrThrow()
    expect(recovery.outcome).toBe("complete")
    expect(JSON.parse(recovery.metadata_json)).toMatchObject({
      originalGenerationId: oldId,
      replacementGenerationId: restarted.id,
      status: "restarted",
    })
    expect(continueChatGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: child.run.id,
        parentId: child.user.id,
        existing: expect.objectContaining({
          generationId: restarted.id,
          seedParts: [{ type: "text", text: "Completed checkpoint" }],
        }),
      })
    )
    await deleteChat(userId, parent.id)
  })

  it("retains a pending helper invocation for replay after a restart", async () => {
    const parent = await createChat(userId, "Parent with pending task")
    const request = await createMessage({
      userId,
      chatId: parent.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "Delegate this" }],
      attachSelection: true,
    })
    const toolCallId = crypto.randomUUID()
    const oldId = crypto.randomUUID()
    const task = { prompt: "Check it" }
    const assistant = await insertNode({
      chatId: parent.id,
      parentId: request.id,
      role: "assistant",
      // The invocation can be durable before the tool part is checkpointed.
      parts: [{ type: "text", text: "Delegating" }],
      status: "streaming",
      generationId: oldId,
    })
    const child = await prepareAgentRun({
      userId,
      parentChatId: parent.id,
      parentNodeId: assistant.id,
      toolCallId,
      task,
    })
    await db
      .insertInto("helper_task_invocations")
      .values({
        tool_call_id: toolCallId,
        parent_node_id: assistant.id,
        root_node_id: assistant.id,
        chat_id: child.run.id,
        input_json: JSON.stringify(task),
        result_json: null,
        created_at: new Date().toISOString(),
        replay_claim_id: null,
        generation_id: oldId,
      })
      .execute()
    await db
      .updateTable("generation_runs")
      .set({ state: "active" })
      .where("id", "=", oldId)
      .execute()

    continueChatGeneration.mockClear()
    await reconcileChatGenerationRuns(parent.id)

    expect(continueChatGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        parentId: request.id,
        existing: expect.objectContaining({
          seedParts: expect.arrayContaining([
            expect.objectContaining({
              toolCallId,
              toolName: "task",
              state: "input-available",
            }),
          ]),
        }),
      })
    )
    await deleteChat(userId, parent.id)
  })
})
