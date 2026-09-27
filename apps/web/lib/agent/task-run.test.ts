import { beforeAll, describe, expect, it } from "vitest"
import { db, migrate, toDbBool } from "@/lib/db"
import {
  createBackup,
  createChat,
  createMessage,
  deleteChat,
  deleteNode,
  helperDeletionImpact,
  replaceMessage,
  updateNode,
} from "@/lib/chat-service"
import {
  deleteHelperProfile,
  listHelperProfiles,
  saveHelperProfile,
} from "@/lib/agent/helper-profiles"
import {
  prepareAgentRun,
  reserveInvocation,
  runAgentTask,
} from "@/lib/agent/task-run"
import { stopAgentRun } from "@/lib/agent/task-controls"
import { parseJson } from "@/lib/domain"
import { ensureUserSettings, setAgentLimits } from "@/lib/user-settings"
import type { Parts } from "@/lib/types"

const userId = "helper-run-owner"

beforeAll(async () => {
  await migrate()
  const found = await db
    .selectFrom("user")
    .select("id")
    .where("id", "=", userId)
    .executeTakeFirst()
  if (!found) {
    const timestamp = new Date().toISOString()
    await db
      .insertInto("user")
      .values({
        id: userId,
        name: userId,
        email: "helper-run@test.local",
        emailVerified: toDbBool(true),
        image: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .execute()
  }
})

async function parentChat() {
  const chat = await createChat(userId, "Parent")
  const request = await createMessage({
    userId,
    chatId: chat.id,
    parentId: null,
    role: "user",
    parts: [{ type: "text", text: "SOURCE_CONTEXT" }],
    attachSelection: true,
  })
  const assistant = await createMessage({
    userId,
    chatId: chat.id,
    parentId: request.id,
    role: "assistant",
    parts: [{ type: "text", text: "CURRENT_REPLY" }],
    attachSelection: true,
  })
  return { chat, assistant }
}

describe("helper runs", () => {
  it("saves and deletes an optional specialist", async () => {
    await ensureUserSettings(userId)
    const stack = await db
      .selectFrom("prompt_stacks")
      .select("id")
      .where("user_id", "=", userId)
      .executeTakeFirstOrThrow()
    const profiles = await saveHelperProfile(userId, {
      key: "reviewer",
      name: "Reviewer",
      description: "Check an answer for gaps.",
      promptStackId: stack.id,
      model: null,
      mcpMode: "none",
      allowTask: true,
      contextMode: "task",
    })
    const reviewer = profiles.find((profile) => profile.key === "reviewer")!
    expect(reviewer.contextMode).toBe("task")
    expect(
      (await createBackup()).helperProfiles.some(
        (profile) => profile.id === reviewer.id
      )
    ).toBe(true)
    const remaining = await deleteHelperProfile(userId, reviewer.id)
    expect(remaining.some((profile) => profile.key === "reviewer")).toBe(false)
  })

  it("uses an ad hoc helper and copies the parent branch in conversation mode", async () => {
    const profiles = await listHelperProfiles(userId)
    expect(profiles).toEqual([])
    const parent = await parentChat()
    const prepared = await prepareAgentRun({
      userId,
      parentChatId: parent.chat.id,
      parentNodeId: parent.assistant.id,
      toolCallId: crypto.randomUUID(),
      task: { prompt: "Review the request" },
    })
    expect(prepared.run.kind).toBe("agent_run")
    const nodes = await db
      .selectFrom("message_nodes")
      .select("parts_json")
      .where("chat_id", "=", prepared.run.id)
      .execute()
    const text = nodes
      .flatMap((node) => parseJson<Parts>(node.parts_json, []))
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
    expect(text).toContain("SOURCE_CONTEXT")
    expect(text).toContain("Review the request")
    expect(text).not.toContain("CURRENT_REPLY")
    const snapshot = JSON.parse(prepared.run.agent_config_json ?? "{}") as {
      stack?: unknown
    }
    expect(snapshot.stack).toBeTruthy()
    await deleteChat(userId, parent.chat.id)
  })

  it("starts independently in task mode and continues the same chat", async () => {
    const parent = await parentChat()
    const first = await prepareAgentRun({
      userId,
      parentChatId: parent.chat.id,
      parentNodeId: parent.assistant.id,
      toolCallId: crypto.randomUUID(),
      task: { prompt: "Independent question", context: "task" },
    })
    await createMessage({
      userId,
      chatId: first.run.id,
      parentId: first.user.id,
      role: "assistant",
      parts: [{ type: "text", text: "First answer" }],
      attachSelection: true,
    })
    const second = await prepareAgentRun({
      userId,
      parentChatId: parent.chat.id,
      parentNodeId: parent.assistant.id,
      toolCallId: crypto.randomUUID(),
      task: { task_id: first.run.id, prompt: "Follow up" },
    })
    expect(second.run.id).toBe(first.run.id)
    const nodes = await db
      .selectFrom("message_nodes")
      .select("parts_json")
      .where("chat_id", "=", first.run.id)
      .execute()
    const text = nodes.map((node) => node.parts_json).join("\n")
    expect(text).not.toContain("SOURCE_CONTEXT")
    expect(text).toContain("Independent question")
    expect(text).toContain("Follow up")
    await deleteChat(userId, parent.chat.id)
  })

  it("enforces the configured helper depth", async () => {
    await setAgentLimits(userId, 1, 20)
    const parent = await parentChat()
    const first = await prepareAgentRun({
      userId,
      parentChatId: parent.chat.id,
      parentNodeId: parent.assistant.id,
      toolCallId: crypto.randomUUID(),
      task: { prompt: "First level" },
    })
    const assistant = await createMessage({
      userId,
      chatId: first.run.id,
      parentId: first.user.id,
      role: "assistant",
      parts: [{ type: "text", text: "Planning" }],
      attachSelection: true,
    })
    await expect(
      prepareAgentRun({
        userId,
        parentChatId: first.run.id,
        parentNodeId: assistant.id,
        toolCallId: crypto.randomUUID(),
        task: { prompt: "Second level" },
      })
    ).rejects.toThrow("Helper depth limit (1) reached")
    await deleteChat(userId, parent.chat.id)
  })

  it("removes helper trees when their task card is edited away or deleted", async () => {
    const parent = await parentChat()
    const firstCall = crypto.randomUUID()
    const first = await prepareAgentRun({
      userId,
      parentChatId: parent.chat.id,
      parentNodeId: parent.assistant.id,
      toolCallId: firstCall,
      task: { prompt: "First task" },
    })
    await updateNode(parent.assistant.id, [
      { type: "text", text: "Delegating" },
      {
        type: "tool-invocation",
        toolCallId: firstCall,
        toolName: "task",
        state: "output-available",
        input: { prompt: "First task" },
        output: { task_id: first.run.id, status: "completed", answer: "Done" },
      },
    ])
    expect(
      (await helperDeletionImpact(userId, parent.assistant.id)).subtree
    ).toBe(1)
    await replaceMessage({
      userId,
      nodeId: parent.assistant.id,
      parts: [{ type: "text", text: "Rewritten without the task" }],
    })
    expect(
      await db
        .selectFrom("chats")
        .select("id")
        .where("id", "=", first.run.id)
        .executeTakeFirst()
    ).toBeUndefined()

    const second = await prepareAgentRun({
      userId,
      parentChatId: parent.chat.id,
      parentNodeId: parent.assistant.id,
      toolCallId: crypto.randomUUID(),
      task: { prompt: "Second task" },
    })
    await deleteNode(userId, parent.assistant.id, "subtree")
    expect(
      await db
        .selectFrom("chats")
        .select("id")
        .where("id", "=", second.run.id)
        .executeTakeFirst()
    ).toBeUndefined()
    await deleteChat(userId, parent.chat.id)
  })

  it("keeps the original helper when only a follow-up card is removed", async () => {
    const parent = await parentChat()
    const firstCall = crypto.randomUUID()
    const first = await prepareAgentRun({
      userId,
      parentChatId: parent.chat.id,
      parentNodeId: parent.assistant.id,
      toolCallId: firstCall,
      task: { prompt: "Original task" },
    })
    await createMessage({
      userId,
      chatId: first.run.id,
      parentId: first.user.id,
      role: "assistant",
      parts: [{ type: "text", text: "Original answer" }],
      attachSelection: true,
    })
    const followupCall = crypto.randomUUID()
    await prepareAgentRun({
      userId,
      parentChatId: parent.chat.id,
      parentNodeId: parent.assistant.id,
      toolCallId: followupCall,
      task: { task_id: first.run.id, prompt: "Follow-up task" },
    })
    const originalPart = {
      type: "tool-invocation" as const,
      toolCallId: firstCall,
      toolName: "task",
      state: "output-available" as const,
      input: { prompt: "Original task" },
      output: {
        task_id: first.run.id,
        status: "completed",
        answer: "Original answer",
      },
    }
    await updateNode(parent.assistant.id, [
      { type: "text", text: "Delegating" },
      originalPart,
      { ...originalPart, toolCallId: followupCall, toolName: "continue_task" },
    ])
    await replaceMessage({
      userId,
      nodeId: parent.assistant.id,
      parts: [{ type: "text", text: "Delegating" }, originalPart],
    })
    expect(
      await db
        .selectFrom("chats")
        .select("id")
        .where("id", "=", first.run.id)
        .executeTakeFirst()
    ).toBeTruthy()
    await deleteChat(userId, parent.chat.id)
  })

  it("keeps same-prompt calls in one generation distinct", async () => {
    const parent = await parentChat()
    const inputJson = JSON.stringify({ prompt: "Same prompt" })
    const first = await reserveInvocation(
      parent.assistant.id,
      parent.assistant.id,
      crypto.randomUUID(),
      inputJson,
      "generation-one"
    )
    const second = await reserveInvocation(
      parent.assistant.id,
      parent.assistant.id,
      crypto.randomUUID(),
      inputJson,
      "generation-one"
    )
    expect(first.existing).toBe(false)
    expect(second.existing).toBe(false)
    expect(first.toolCallId).not.toBe(second.toolCallId)
    const replay = await reserveInvocation(
      parent.assistant.id,
      parent.assistant.id,
      crypto.randomUUID(),
      inputJson,
      "generation-two"
    )
    expect(replay.existing).toBe(true)
    await deleteChat(userId, parent.chat.id)
  })

  it("keeps uploaded attachments in a conversation snapshot", async () => {
    const parent = await createChat(userId, "With image")
    const attachmentId = crypto.randomUUID()
    await db
      .insertInto("attachments")
      .values({
        id: attachmentId,
        user_id: userId,
        filename: "photo.png",
        media_type: "image/png",
        byte_size: 4,
        sha256: "a".repeat(64),
        storage_backend: "database",
        storage_key: null,
        data: new Uint8Array([1, 2, 3, 4]),
        claimed_at: null,
        created_at: new Date().toISOString(),
      })
      .execute()
    const request = await createMessage({
      userId,
      chatId: parent.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "Examine this" }],
      attachments: [{ kind: "uploaded-file", id: attachmentId }],
      attachSelection: true,
    })
    const assistant = await createMessage({
      userId,
      chatId: parent.id,
      parentId: request.id,
      role: "assistant",
      parts: [{ type: "text", text: "I will ask a helper" }],
      attachSelection: true,
    })
    const prepared = await prepareAgentRun({
      userId,
      parentChatId: parent.id,
      parentNodeId: assistant.id,
      toolCallId: crypto.randomUUID(),
      task: { prompt: "Describe the image" },
    })
    const copied = await db
      .selectFrom("message_attachments")
      .select("attachment_id")
      .innerJoin(
        "message_nodes",
        "message_nodes.id",
        "message_attachments.message_node_id"
      )
      .where("message_nodes.chat_id", "=", prepared.run.id)
      .execute()
    expect(copied.map((row) => row.attachment_id)).toContain(attachmentId)
    await deleteChat(userId, parent.id)
  })

  it("stops a paused helper and its nested descendants", async () => {
    await setAgentLimits(userId, 2, 20)
    const parent = await parentChat()
    const first = await prepareAgentRun({
      userId,
      parentChatId: parent.chat.id,
      parentNodeId: parent.assistant.id,
      toolCallId: crypto.randomUUID(),
      task: { prompt: "First level" },
    })
    const firstAssistant = await createMessage({
      userId,
      chatId: first.run.id,
      parentId: first.user.id,
      role: "assistant",
      parts: [{ type: "text", text: "Delegating" }],
      attachSelection: true,
    })
    const second = await prepareAgentRun({
      userId,
      parentChatId: first.run.id,
      parentNodeId: firstAssistant.id,
      toolCallId: crypto.randomUUID(),
      task: { prompt: "Second level" },
    })
    expect(
      (await helperDeletionImpact(userId, parent.assistant.id)).subtree
    ).toBe(2)
    const waiting = await createMessage({
      userId,
      chatId: second.run.id,
      parentId: second.user.id,
      role: "assistant",
      parts: [{ type: "text", text: "Need an answer" }],
      attachSelection: true,
    })
    await db
      .updateTable("message_nodes")
      .set({ status: "awaiting_input" })
      .where("id", "=", waiting.id)
      .execute()
    expect(await stopAgentRun(userId, first.run.id)).toEqual({ stopped: 2 })
    const stopped = await db
      .selectFrom("message_nodes")
      .select("status")
      .where("id", "=", waiting.id)
      .executeTakeFirstOrThrow()
    expect(stopped.status).toBe("stopped")
    await deleteChat(userId, parent.chat.id)
    await setAgentLimits(userId, 1, 20)
  })

  it("reuses a recorded task result when a recovered model repeats the call", async () => {
    const parent = await parentChat()
    const task = { prompt: "Already answered" }
    const result = {
      task_id: crypto.randomUUID(),
      status: "completed" as const,
      answer: "Saved result",
    }
    await db
      .insertInto("helper_task_invocations")
      .values({
        parent_node_id: parent.assistant.id,
        tool_call_id: crypto.randomUUID(),
        root_node_id: parent.assistant.id,
        chat_id: null,
        input_json: JSON.stringify(task),
        result_json: JSON.stringify(result),
        created_at: new Date().toISOString(),
      })
      .execute()
    const output = await runAgentTask({
      context: {
        userId,
        parentChatId: parent.chat.id,
        parentNodeId: parent.assistant.id,
        timeZone: "UTC",
        abortSignal: new AbortController().signal,
        publish: async () => {},
      },
      toolCallId: crypto.randomUUID(),
      input: task,
    })
    expect(output).toEqual(result)
    await deleteChat(userId, parent.chat.id)
  })
})
