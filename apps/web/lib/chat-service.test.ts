import { beforeAll, describe, expect, it } from "vitest"
import {
  createChat,
  createProvider,
  createTurn,
  deleteNode,
  getWorkspace,
  insertNode,
  nodeParts,
  startGenerate,
  startRegenerate,
} from "@/lib/chat-service"
import { parseBackup } from "@/lib/backup"
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
    expect(nodeParts(first)[0]?.text).toBe("first")
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
      chatId: chat.id,
      parentId: prior.id,
      content: "hello turn",
      assistantMetadata: { model: "test" },
    })
    expect(user.parent_id).toBe(prior.id)
    expect(assistant.parent_id).toBe(user.id)
    expect(assistant.status).toBe("streaming")
    expect(nodeParts(user)[0]?.text).toBe("hello turn")

    const workspace = await getWorkspace(userId, { chatId: chat.id })
    // Prior insert attached selection to prior; createTurn must not redirect it.
    expect(workspace.chat?.selected_root_node_id).toBe(prior.id)
    const priorRow = workspace.nodes.find((n) => n.id === prior.id)
    expect(priorRow?.selected_child_id).toBeNull()
    const userRow = workspace.nodes.find((n) => n.id === user.id)
    expect(userRow?.selected_child_id).toBeNull()
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
  })

  it("rejects wrong version", () => {
    expect(() => parseBackup({ version: 2, chats: [], nodes: [] })).toThrow()
  })
})
