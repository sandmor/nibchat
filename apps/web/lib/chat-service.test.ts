import { beforeAll, describe, expect, it } from "vitest"
import {
  beginResumeAssistant,
  createBackup,
  createBackupArchive,
  createChat,
  createProvider,
  createTurn,
  deleteChat,
  deleteNode,
  finalizeStreamingAssistant,
  forkEdit,
  getWorkspace,
  insertNode,
  nodeParts,
  restoreAwaitingInput,
  startGenerate,
  startRegenerate,
} from "@/lib/chat-service"
import {
  isGenerationActive,
  registerGeneration,
  clearActiveGenerations,
} from "@/lib/active-generations"
import { parseBackup } from "@/lib/backup"
import { unpackBackupArchive } from "@/lib/backup-archive"
import { db, migrate } from "@/lib/db"
import { ancestorPath, parseJson, resolveActivePath } from "@/lib/domain"
import { formatProviderError } from "@/lib/provider-errors"
import { modelFor, type ModelConfig } from "@/lib/providers"

const userId = "test-owner"
beforeAll(async () => {
  await migrate()
  const existing = await db
    .selectFrom("user")
    .select("id")
    .where("id", "=", userId)
    .executeTakeFirst()
  if (!existing)
    await db
      .insertInto("user")
      .values({
        id: userId,
        name: "Owner",
        email: "owner@test.local",
        // better-sqlite3 accepts 0/1, not JS booleans.
        emailVerified: 1 as unknown as boolean,
        image: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .execute()
})

describe("SQLite chat repository", () => {
  it("persists a selected branch", async () => {
    const chat = await createChat(userId, "Repository test")
    const root = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "root" }],
    })
    const first = await insertNode({
      chatId: chat.id,
      parentId: root.id,
      role: "assistant",
      parts: [{ type: "text", text: "first" }],
    })
    const second = await insertNode({
      chatId: chat.id,
      parentId: root.id,
      role: "assistant",
      parts: [{ type: "text", text: "second" }],
    })
    const workspace = await getWorkspace(userId, { chatId: chat.id })
    expect(
      resolveActivePath(
        workspace.nodes,
        workspace.chat?.selected_root_node_id ?? null
      ).at(-1)?.id
    ).toBe(second.id)
    const firstText = nodeParts(first)[0]
    expect(firstText?.type === "text" ? firstText.text : undefined).toBe(
      "first"
    )
  })

  it("createTurn inserts user + streaming assistant without rewriting view selection", async () => {
    const chat = await createChat(userId, "Turn test")
    const prior = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "prior" }],
    })
    const { user, assistant } = await createTurn({
      userId,
      chatId: chat.id,
      parentId: prior.id,
      content: "hello turn",
      assistantMetadata: { model: "test" },
    })
    expect(user.parent_id).toBe(prior.id)
    expect(assistant.parent_id).toBe(user.id)
    expect(assistant.status).toBe("streaming")
    const userText = nodeParts(user)[0]
    expect(userText?.type === "text" ? userText.text : undefined).toBe(
      "hello turn"
    )

    const workspace = await getWorkspace(userId, { chatId: chat.id })
    // Prior insert attached selection to prior; createTurn must not redirect it.
    expect(workspace.chat?.selected_root_node_id).toBe(prior.id)
    const priorRow = workspace.nodes.find((n) => n.id === prior.id)
    expect(priorRow?.selected_child_id).toBeNull()
    const userRow = workspace.nodes.find((n) => n.id === user.id)
    expect(userRow?.selected_child_id).toBeNull()
  })

  it("createTurn persists attachment-only user turns", async () => {
    const chat = await createChat(userId, "Attachment turn")
    const { user } = await createTurn({
      userId,
      chatId: chat.id,
      parentId: null,
      content: "",
      attachments: [
        {
          type: "attachment",
          id: "attachment-1",
          name: "Usage Guide",
          content: { kind: "text", text: "Guide body." },
          source: {
            kind: "mcp-resource",
            profileId: "profile-1",
            profileName: "Docs",
            uri: "help://usage-guide",
          },
        },
      ],
      assistantMetadata: {},
    })
    expect(nodeParts(user)).toEqual([
      {
        type: "attachment",
        id: "attachment-1",
        name: "Usage Guide",
        content: { kind: "text", text: "Guide body." },
        source: {
          kind: "mcp-resource",
          profileId: "profile-1",
          profileName: "Docs",
          uri: "help://usage-guide",
        },
      },
    ])
  })

  it("createTurn under a branch parent does not rewire an upstream selection tip", async () => {
    const chat = await createChat(userId, "Concurrent tip")
    const root = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "root" }],
    })
    const leaf = await insertNode({
      chatId: chat.id,
      parentId: root.id,
      role: "assistant",
      parts: [{ type: "text", text: "leaf" }],
    })
    // Selection points at leaf tip A
    const pathBefore = resolveActivePath(
      (await getWorkspace(userId, { chatId: chat.id })).nodes,
      (await getWorkspace(userId, { chatId: chat.id })).chat
        ?.selected_root_node_id ?? null
    )
    expect(pathBefore.at(-1)?.id).toBe(leaf.id)

    // Turn parents under root while selection still favors leaf
    const { user, assistant } = await createTurn({
      userId,
      chatId: chat.id,
      parentId: root.id,
      content: "branch turn",
      assistantMetadata: {},
    })
    expect(user.parent_id).toBe(root.id)
    expect(assistant.parent_id).toBe(user.id)

    const workspace = await getWorkspace(userId, { chatId: chat.id })
    const path = resolveActivePath(
      workspace.nodes,
      workspace.chat?.selected_root_node_id ?? null
    )
    expect(path.map((n) => n.id)).toEqual([root.id, leaf.id])
    const rootRow = workspace.nodes.find((n) => n.id === root.id)
    expect(rootRow?.selected_child_id).toBe(leaf.id)
  })

  it("keeps image bytes while an edited branch still references them", async () => {
    const chat = await createChat(userId, "Attachment branch")
    const original = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [
        {
          type: "attachment",
          id: "image-branch",
          name: "image.png",
          source: { kind: "upload" },
          content: {
            kind: "binary",
            attachmentId: "image-branch",
            mediaType: "image/png",
            byteSize: 4,
            sha256: "a".repeat(64),
          },
        },
        { type: "text", text: "original" },
      ],
    })
    await db
      .insertInto("attachments")
      .values({
        id: "image-branch",
        user_id: userId,
        filename: "image.png",
        media_type: "image/png",
        byte_size: 4,
        sha256: "a".repeat(64),
        storage_backend: "database",
        storage_key: null,
        data: new Uint8Array([1, 2, 3, 4]),
        claimed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      })
      .execute()
    await db
      .insertInto("message_attachments")
      .values({ message_node_id: original.id, attachment_id: "image-branch" })
      .execute()
    const edited = await forkEdit(userId, original.id, "edited")
    await deleteNode(userId, original.id, "subtree")
    const reference = await db
      .selectFrom("message_attachments")
      .selectAll()
      .where("message_node_id", "=", edited.id)
      .executeTakeFirst()
    const attachment = await db
      .selectFrom("attachments")
      .select("id")
      .where("id", "=", "image-branch")
      .executeTakeFirst()
    expect(reference?.attachment_id).toBe("image-branch")
    expect(attachment?.id).toBe("image-branch")
  })

  it("keeps pending uploads when sweeping detached claimed images", async () => {
    const pendingId = crypto.randomUUID()
    const orphanId = crypto.randomUUID()
    await db
      .insertInto("attachments")
      .values([
        {
          id: pendingId,
          user_id: userId,
          filename: "pending.png",
          media_type: "image/png",
          byte_size: 4,
          sha256: "b".repeat(64),
          storage_backend: "database",
          storage_key: null,
          data: new Uint8Array([1, 2, 3, 4]),
          claimed_at: null,
          created_at: new Date().toISOString(),
        },
        {
          id: orphanId,
          user_id: userId,
          filename: "orphan.png",
          media_type: "image/png",
          byte_size: 4,
          sha256: "c".repeat(64),
          storage_backend: "database",
          storage_key: null,
          data: new Uint8Array([1, 2, 3, 4]),
          claimed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
      ])
      .execute()
    const chat = await createChat(userId, "Pending sweep")
    await deleteChat(userId, chat.id)
    const pending = await db
      .selectFrom("attachments")
      .select("id")
      .where("id", "=", pendingId)
      .executeTakeFirst()
    const orphan = await db
      .selectFrom("attachments")
      .select("id")
      .where("id", "=", orphanId)
      .executeTakeFirst()
    expect(pending?.id).toBe(pendingId)
    expect(orphan).toBeUndefined()
    await db.deleteFrom("attachments").where("id", "=", pendingId).execute()
  })

  it("createBackup references attachment files in a zip archive", async () => {
    const chat = await createChat(userId, "Backup images")
    const attachmentId = crypto.randomUUID()
    const original = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [
        {
          type: "attachment",
          id: attachmentId,
          name: "shot.png",
          source: { kind: "upload" },
          content: {
            kind: "binary",
            attachmentId,
            mediaType: "image/png",
            byteSize: 4,
            sha256: "d".repeat(64),
          },
        },
        { type: "text", text: "see this" },
      ],
    })
    await db
      .insertInto("attachments")
      .values({
        id: attachmentId,
        user_id: userId,
        filename: "shot.png",
        media_type: "image/png",
        byte_size: 4,
        sha256: "d".repeat(64),
        storage_backend: "database",
        storage_key: null,
        data: new Uint8Array([9, 8, 7, 6]),
        claimed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      })
      .execute()
    await db
      .insertInto("message_attachments")
      .values({ message_node_id: original.id, attachment_id: attachmentId })
      .execute()
    const backup = await createBackup(userId)
    const row = backup.attachments.find((item) => item.id === attachmentId)
    expect(row?.file).toBe(`attachments/${attachmentId}`)
    expect(row && "data" in row).toBe(false)
    expect(
      backup.messageAttachments.some(
        (link) =>
          link.message_node_id === original.id &&
          link.attachment_id === attachmentId
      )
    ).toBe(true)
    const zip = await createBackupArchive(userId)
    const unpacked = unpackBackupArchive(zip)
    expect([...unpacked.files.get(row!.file)!]).toEqual([9, 8, 7, 6])
    expect(
      unpacked.backup.attachments.some((item) => item.id === attachmentId)
    ).toBe(true)
  })

  it("deleteNode reparent promotes a single child and fixes selection", async () => {
    const chat = await createChat(userId, "Delete reparent")
    const root = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "root" }],
    })
    const mid = await insertNode({
      chatId: chat.id,
      parentId: root.id,
      role: "assistant",
      parts: [{ type: "text", text: "mid" }],
    })
    const leaf = await insertNode({
      chatId: chat.id,
      parentId: mid.id,
      role: "user",
      parts: [{ type: "text", text: "leaf" }],
    })
    await deleteNode(userId, mid.id, "reparent")
    const workspace = await getWorkspace(userId, { chatId: chat.id })
    const leafRow = workspace.nodes.find((n) => n.id === leaf.id)
    expect(leafRow?.parent_id).toBe(root.id)
    expect(workspace.nodes.some((n) => n.id === mid.id)).toBe(false)
    const rootRow = workspace.nodes.find((n) => n.id === root.id)
    expect(rootRow?.selected_child_id).toBe(leaf.id)
  })

  it("deleteNode subtree reselects a sibling when the selected child is deleted", async () => {
    const chat = await createChat(userId, "Delete subtree")
    const root = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "root" }],
    })
    const a = await insertNode({
      chatId: chat.id,
      parentId: root.id,
      role: "assistant",
      parts: [{ type: "text", text: "a" }],
    })
    const b = await insertNode({
      chatId: chat.id,
      parentId: root.id,
      role: "assistant",
      parts: [{ type: "text", text: "b" }],
    })
    await deleteNode(userId, b.id, "subtree")
    const workspace = await getWorkspace(userId, { chatId: chat.id })
    expect(workspace.nodes.some((n) => n.id === b.id)).toBe(false)
    const rootRow = workspace.nodes.find((n) => n.id === root.id)
    expect(rootRow?.selected_child_id).toBe(a.id)
  })

  it("seeds new chats from latest chat model config when available", async () => {
    const provider = await createProvider(userId, {
      name: `Seed provider ${Date.now()}`,
      kind: "openai-compatible",
      baseUrl: "http://127.0.0.1:8080/v1",
      models: ["seed-model"],
    })
    await createChat(userId, "Template chat", {
      providerId: provider.id,
      model: "seed-model",
    })
    const chat = await createChat(userId, "Seeded chat")
    const config = parseJson<ModelConfig>(chat.model_config_json, {})
    expect(config.providerId).toBe(provider.id)
    expect(config.model).toBe("seed-model")
  })
})

describe("branch stream helpers", () => {
  it("startRegenerate creates sibling without forcing selection onto new assistant", async () => {
    const chat = await createChat(userId, "Regen test")
    const firstAssistant = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "assistant",
      parts: [{ type: "text", text: "root asst" }],
    })
    const second = await insertNode({
      chatId: chat.id,
      parentId: firstAssistant.id,
      role: "assistant",
      parts: [{ type: "text", text: "child asst" }],
    })
    const { assistant, contextLeafId } = await startRegenerate(
      userId,
      second.id
    )
    expect(assistant.role).toBe("assistant")
    expect(assistant.parent_id).toBe(firstAssistant.id)
    expect(assistant.status).toBe("streaming")
    expect(contextLeafId).toBe(firstAssistant.id)
    expect(assistant.id).not.toBe(second.id)

    const workspace = await getWorkspace(userId, { chatId: chat.id })
    // Selection still follows insertNode order: second was selected under first
    const path = resolveActivePath(
      workspace.nodes,
      workspace.chat?.selected_root_node_id ?? null
    )
    expect(path.map((n) => n.id)).toEqual([firstAssistant.id, second.id])
    const parent = workspace.nodes.find((n) => n.id === firstAssistant.id)
    expect(parent?.selected_child_id).toBe(second.id)

    const ctx = ancestorPath(workspace.nodes, contextLeafId!)
    expect(ctx.map((n) => n.id)).toEqual([firstAssistant.id])
    expect(ctx.every((n) => n.role === "assistant")).toBe(true)
  })

  it("startGenerate attaches under parent without rewriting view selection", async () => {
    const chat = await createChat(userId, "Generate test")
    const userMsg = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "hi" }],
    })
    const existingChild = await insertNode({
      chatId: chat.id,
      parentId: userMsg.id,
      role: "assistant",
      parts: [{ type: "text", text: "old" }],
    })
    const { assistant, contextLeafId } = await startGenerate(userId, userMsg.id)
    expect(assistant.parent_id).toBe(userMsg.id)
    expect(contextLeafId).toBe(userMsg.id)
    expect(assistant.status).toBe("streaming")

    const workspace = await getWorkspace(userId, { chatId: chat.id })
    const path = resolveActivePath(
      workspace.nodes,
      workspace.chat?.selected_root_node_id ?? null
    )
    expect(path.map((n) => n.id)).toEqual([userMsg.id, existingChild.id])
    const parent = workspace.nodes.find((n) => n.id === userMsg.id)
    expect(parent?.selected_child_id).toBe(existingChild.id)
  })

  it("startRegenerate rejects non-assistant targets", async () => {
    const chat = await createChat(userId, "Regen reject")
    const userMsg = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "nope" }],
    })
    await expect(startRegenerate(userId, userMsg.id)).rejects.toThrow(
      /assistant/i
    )
  })
})

describe("generation abort + finalize", () => {
  it("deleteNode subtree aborts registered generations under the root", async () => {
    clearActiveGenerations()
    const chat = await createChat(userId, "Abort on delete")
    const userMsg = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "u" }],
    })
    const streaming = await insertNode({
      chatId: chat.id,
      parentId: userMsg.id,
      role: "assistant",
      parts: [],
      status: "streaming",
      attachSelection: false,
    })
    const controller = new AbortController()
    registerGeneration(streaming.id, controller)
    expect(isGenerationActive(streaming.id)).toBe(true)

    await deleteNode(userId, userMsg.id, "subtree")

    expect(controller.signal.aborted).toBe(true)
    expect(isGenerationActive(streaming.id)).toBe(false)
    const workspace = await getWorkspace(userId, { chatId: chat.id })
    expect(workspace.nodes.some((n) => n.id === streaming.id)).toBe(false)
  })

  it("finalizeStreamingAssistant keeps non-empty aborted partials as stopped", async () => {
    const chat = await createChat(userId, "Finalize keep")
    const assistant = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "assistant",
      parts: [],
      status: "streaming",
    })
    const result = await finalizeStreamingAssistant({
      nodeId: assistant.id,
      outcome: "aborted",
      text: "  half reply  ",
      reasoning: "",
    })
    expect(result).toBe("stopped")
    const workspace = await getWorkspace(userId, { chatId: chat.id })
    const row = workspace.nodes.find((n) => n.id === assistant.id)
    expect(row?.status).toBe("stopped")
    const half = nodeParts(row!)[0]
    expect(half?.type === "text" ? half.text : undefined).toBe("half reply")
  })

  it("finalizeStreamingAssistant deletes empty shells", async () => {
    const chat = await createChat(userId, "Finalize drop")
    const userMsg = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "ask" }],
    })
    const assistant = await insertNode({
      chatId: chat.id,
      parentId: userMsg.id,
      role: "assistant",
      parts: [],
      status: "streaming",
    })
    const result = await finalizeStreamingAssistant({
      nodeId: assistant.id,
      outcome: "aborted",
      text: "  ",
      reasoning: "",
    })
    expect(result).toBe("deleted")
    const workspace = await getWorkspace(userId, { chatId: chat.id })
    expect(workspace.nodes.some((n) => n.id === assistant.id)).toBe(false)
    expect(workspace.nodes.some((n) => n.id === userMsg.id)).toBe(true)
  })

  it("finalizeStreamingAssistant is a no-op for missing nodes", async () => {
    const result = await finalizeStreamingAssistant({
      nodeId: "does-not-exist",
      outcome: "aborted",
      text: "x",
    })
    expect(result).toBe("missing")
  })

  it("finalizeStreamingAssistant complete writes complete status", async () => {
    const chat = await createChat(userId, "Finalize complete")
    const assistant = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "assistant",
      parts: [],
      status: "streaming",
    })
    const result = await finalizeStreamingAssistant({
      nodeId: assistant.id,
      outcome: "complete",
      text: "full reply",
      reasoning: "thinking",
      finishReason: "stop",
      usage: { totalTokens: 1 },
      config: { providerId: "p", model: "m" },
    })
    expect(result).toBe("complete")
    const workspace = await getWorkspace(userId, { chatId: chat.id })
    const row = workspace.nodes.find((n) => n.id === assistant.id)
    expect(row?.status).toBe("complete")
    expect(
      nodeParts(row!)
        .filter((p) => p.type === "text" || p.type === "reasoning")
        .map((p) => p.text)
    ).toEqual(["thinking", "full reply"])
  })

  it("finalizeStreamingAssistant awaiting_input persists tool parts", async () => {
    const chat = await createChat(userId, "Finalize awaiting")
    const assistant = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "assistant",
      parts: [],
      status: "streaming",
    })
    const parts = [
      { type: "text" as const, text: "Need a decision." },
      {
        type: "tool-invocation" as const,
        toolCallId: "c1",
        toolName: "question",
        state: "input-available" as const,
        input: {
          questions: [
            {
              question: "Pick?",
              header: "Pick",
              options: [{ label: "Yes", description: "Yes" }],
            },
          ],
        },
      },
    ]
    const result = await finalizeStreamingAssistant({
      nodeId: assistant.id,
      outcome: "awaiting_input",
      parts,
    })
    expect(result).toBe("awaiting_input")
    const workspace = await getWorkspace(userId, { chatId: chat.id })
    const row = workspace.nodes.find((n) => n.id === assistant.id)
    expect(row?.status).toBe("awaiting_input")
    expect(nodeParts(row!)).toEqual(parts)
  })

  it("finalizeStreamingAssistant complete on missing is missing", async () => {
    const result = await finalizeStreamingAssistant({
      nodeId: "gone",
      outcome: "complete",
      text: "x",
    })
    expect(result).toBe("missing")
  })

  it("finalizeStreamingAssistant complete when already stopped is superseded", async () => {
    const chat = await createChat(userId, "Finalize superseded")
    const assistant = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "assistant",
      parts: [{ type: "text", text: "partial" }],
      status: "stopped",
    })
    const result = await finalizeStreamingAssistant({
      nodeId: assistant.id,
      outcome: "complete",
      text: "should not win",
    })
    expect(result).toBe("superseded")
    const workspace = await getWorkspace(userId, { chatId: chat.id })
    const row = workspace.nodes.find((n) => n.id === assistant.id)
    expect(row?.status).toBe("stopped")
    const partial = nodeParts(row!)[0]
    expect(partial?.type === "text" ? partial.text : undefined).toBe("partial")
  })

  it("second finalize returns superseded", async () => {
    const chat = await createChat(userId, "Double finalize")
    const assistant = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "assistant",
      parts: [],
      status: "streaming",
    })
    const first = await finalizeStreamingAssistant({
      nodeId: assistant.id,
      outcome: "complete",
      text: "first",
    })
    const second = await finalizeStreamingAssistant({
      nodeId: assistant.id,
      outcome: "error",
      text: "second",
      error: "nope",
    })
    expect(first).toBe("complete")
    expect(second).toBe("superseded")
    const workspace = await getWorkspace(userId, { chatId: chat.id })
    const row = workspace.nodes.find((n) => n.id === assistant.id)
    expect(row?.status).toBe("complete")
  })

  it("finalizeStreamingAssistant error on missing is missing", async () => {
    const result = await finalizeStreamingAssistant({
      nodeId: "gone",
      outcome: "error",
      text: "x",
      error: "boom",
    })
    expect(result).toBe("missing")
  })
})

describe("modelFor preflight", () => {
  it("requires API key", async () => {
    const provider = await createProvider(userId, {
      name: `No key ${Date.now()}`,
      kind: "openai",
      models: ["gpt-4o-mini"],
    })
    await expect(
      modelFor(userId, { providerId: provider.id, model: "gpt-4o-mini" })
    ).rejects.toThrow(/Missing API key/)
  })

  it("requires base URL for openai-compatible", async () => {
    const provider = await createProvider(userId, {
      name: `No base ${Date.now()}`,
      kind: "openai-compatible",
      apiKey: "sk-test",
      models: ["local-model"],
    })
    await expect(
      modelFor(userId, { providerId: provider.id, model: "local-model" })
    ).rejects.toThrow(/base URL/)
  })

  it("surfaces setup failures via formatProviderError", async () => {
    try {
      await modelFor(userId, {})
      expect.unreachable()
    } catch (error) {
      expect(formatProviderError(error)).toMatch(/provider and model/i)
    }
  })
})

describe("backup schema", () => {
  it("accepts a minimal v1 backup", () => {
    const backup = parseBackup({
      version: 1,
      chats: [],
      nodes: [],
    })
    expect(backup.version).toBe(1)
    expect(backup.providerProfiles).toEqual([])
    expect(backup.promptStacks).toEqual([])
    expect(backup.attachments).toEqual([])
    expect(backup.messageAttachments).toEqual([])
  })

  it("rejects wrong version", () => {
    expect(() => parseBackup({ version: 2, chats: [], nodes: [] })).toThrow()
  })
})

describe("resume claim and restore", () => {
  const pendingParts = [
    {
      type: "tool-invocation" as const,
      toolCallId: "call-1",
      toolName: "question",
      state: "input-available" as const,
      input: {
        questions: [
          {
            question: "Pick one?",
            header: "Pick",
            options: [{ label: "A", description: "A" }],
            multiple: false,
            custom: true,
          },
        ],
      },
    },
  ]
  const answeredParts = [
    {
      ...pendingParts[0]!,
      state: "output-available" as const,
      output: {
        title: "Asked 1 question",
        output: "ok",
        metadata: { answers: [["A"]] },
      },
    },
  ]

  it("claims awaiting_input → streaming with applied parts", async () => {
    const chat = await createChat(userId, "Resume claim")
    const user = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "hi" }],
    })
    const assistant = await insertNode({
      chatId: chat.id,
      parentId: user.id,
      role: "assistant",
      parts: pendingParts,
      status: "awaiting_input",
    })

    const claimed = await beginResumeAssistant(assistant.id, answeredParts)
    expect(claimed).toBe("streaming")

    const row = await db
      .selectFrom("message_nodes")
      .selectAll()
      .where("id", "=", assistant.id)
      .executeTakeFirstOrThrow()
    expect(row.status).toBe("streaming")
    expect(nodeParts(row)[0]).toMatchObject({ state: "output-available" })
  })

  it("rejects double claim (superseded)", async () => {
    const chat = await createChat(userId, "Resume race")
    const user = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "hi" }],
    })
    const assistant = await insertNode({
      chatId: chat.id,
      parentId: user.id,
      role: "assistant",
      parts: pendingParts,
      status: "awaiting_input",
    })
    expect(await beginResumeAssistant(assistant.id, answeredParts)).toBe(
      "streaming"
    )
    expect(await beginResumeAssistant(assistant.id, answeredParts)).toBe(
      "superseded"
    )
  })

  it("restores awaiting_input with original parts after failed setup", async () => {
    const chat = await createChat(userId, "Resume restore")
    const user = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "hi" }],
    })
    const assistant = await insertNode({
      chatId: chat.id,
      parentId: user.id,
      role: "assistant",
      parts: pendingParts,
      status: "awaiting_input",
    })
    expect(await beginResumeAssistant(assistant.id, answeredParts)).toBe(
      "streaming"
    )
    expect(await restoreAwaitingInput(assistant.id, pendingParts)).toBe(
      "awaiting_input"
    )

    const row = await db
      .selectFrom("message_nodes")
      .selectAll()
      .where("id", "=", assistant.id)
      .executeTakeFirstOrThrow()
    expect(row.status).toBe("awaiting_input")
    expect(nodeParts(row)[0]).toMatchObject({ state: "input-available" })
  })

  it("does not restore when node is no longer streaming", async () => {
    const chat = await createChat(userId, "Resume restore guard")
    const user = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "hi" }],
    })
    const assistant = await insertNode({
      chatId: chat.id,
      parentId: user.id,
      role: "assistant",
      parts: pendingParts,
      status: "awaiting_input",
    })
    expect(await restoreAwaitingInput(assistant.id, pendingParts)).toBe(
      "superseded"
    )
  })
})

describe("prompt stacks", () => {
  it("supports create, chat ref, orphan clear on delete", async () => {
    const {
      createPromptStack,
      deletePromptStack,
      resolveStackForChat,
      setChatPromptStack,
    } = await import("@/lib/chat-service")
    const stack = await createPromptStack({
      name: "Coding",
      stack: {
        modules: [
          {
            id: "m1",
            kind: "prompt",
            name: "Sys",
            enabled: true,
            body: "Be concise.",
            placement: "relative",
            role: "system",
          },
          {
            id: "h",
            kind: "history",
            name: "Chat history",
            enabled: true,
          },
        ],
      },
    })
    const chat = await createChat(userId, "Stack test", undefined, stack.id)
    expect(chat.prompt_stack_id).toBe(stack.id)
    const resolved = await resolveStackForChat(chat)
    expect(resolved.source).toBe("chat")
    const first = resolved.stack.modules[0]
    expect(first?.kind).toBe("prompt")
    if (first?.kind === "prompt") {
      expect(first.body).toBe("Be concise.")
    }

    await setChatPromptStack(userId, chat.id, null)
    const afterClear = await db
      .selectFrom("chats")
      .select("prompt_stack_id")
      .where("id", "=", chat.id)
      .executeTakeFirstOrThrow()
    expect(afterClear.prompt_stack_id).toBeNull()

    await setChatPromptStack(userId, chat.id, stack.id)
    await deletePromptStack(stack.id)
    const afterDelete = await db
      .selectFrom("chats")
      .select("prompt_stack_id")
      .where("id", "=", chat.id)
      .executeTakeFirstOrThrow()
    expect(afterDelete.prompt_stack_id).toBeNull()

    await expect(deletePromptStack("default")).rejects.toThrow(
      /instance default/i
    )
  })

  it("previewAssembledContext includes system from default stack", async () => {
    const { previewAssembledContext } = await import("@/lib/chat-service")
    const chat = await createChat(userId, "Preview")
    await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "hi" }],
    })
    const preview = await previewAssembledContext(userId, { chatId: chat.id })
    expect(preview.system).toContain("helpful assistant")
    expect(preview.source).toBe("instance")
  })
})
