import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import {
  beginResumeAssistant,
  createBackup,
  createBackupArchive,
  createChat,
  createProvider,
  finishSetup,
  getTitleModelConfig,
  createTurn,
  deleteChat,
  deleteNode,
  finalizeStreamingAssistant,
  forkEdit,
  getWorkspace,
  insertNode,
  nodeParts,
  restoreAwaitingInput,
  restoreBackup,
  setNodeContextExcluded,
  startRegenerate,
  setChatViewState,
} from "@/lib/chat-service"
import { getGenerationRun } from "@/lib/generation-runs"
import { generationStreamStore } from "@/lib/generation-streams/default-port"
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
import {
  listAvailableProviders,
  listProviders,
  modelFor,
  resolveModelConfig,
  type ModelConfig,
} from "@/lib/providers"
import { getUserSettings } from "@/lib/user-settings"
import { SEED_THEMES } from "@/lib/appearance"
import { defaultPromptStack, promptStackToJson } from "@/lib/prompt-stack"
import { parseChatViewState } from "@/lib/chat-view-state"

const userId = "test-owner"
afterEach(() => {
  vi.restoreAllMocks()
})
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

  it("toggles context exclusion on one node without changing its branch", async () => {
    const chat = await createChat(userId, "Context exclusion")
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

    await setNodeContextExcluded(userId, first.id, true)
    const workspace = await getWorkspace(userId, { chatId: chat.id })
    const firstStored = workspace.nodes.find((node) => node.id === first.id)
    const secondStored = workspace.nodes.find((node) => node.id === second.id)
    expect(firstStored?.excluded_from_context).toBe(true)
    expect(secondStored?.excluded_from_context).toBe(false)
    expect(workspace.chat?.selected_root_node_id).toBe(root.id)
    const backup = await createBackup()
    expect(
      backup.nodes.find((node) => node.id === first.id)?.excluded_from_context
    ).toBe(true)

    await setNodeContextExcluded(userId, first.id, false)
    const restored = await getWorkspace(userId, { chatId: chat.id })
    expect(
      restored.nodes.find((node) => node.id === first.id)?.excluded_from_context
    ).toBe(false)
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

  it("can fork an edit without rewriting the selected linear branch", async () => {
    const chat = await createChat(userId, "Tree edit selection")
    const root = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "root" }],
    })
    const selected = await insertNode({
      chatId: chat.id,
      parentId: root.id,
      role: "assistant",
      parts: [{ type: "text", text: "selected" }],
    })
    const edited = await forkEdit(
      userId,
      selected.id,
      [{ type: "text", text: "tree edit" }],
      {
        attachSelection: false,
      }
    )
    const workspace = await getWorkspace(userId, { chatId: chat.id })
    expect(edited.parent_id).toBe(root.id)
    expect(
      resolveActivePath(
        workspace.nodes,
        workspace.chat?.selected_root_node_id ?? null
      ).at(-1)?.id
    ).toBe(selected.id)
  })

  it("forks an edit while keeping interleaved reasoning and tools", async () => {
    const chat = await createChat(userId, "Interleaved edit")
    const original = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "assistant",
      parts: [
        { type: "reasoning", text: "think first" },
        { type: "text", text: "before" },
        {
          type: "tool-invocation",
          toolCallId: "c1",
          toolName: "web_search",
          state: "output-available",
          input: { q: "nib" },
          output: "hits",
        },
        { type: "text", text: "after" },
      ],
    })
    const edited = await forkEdit(userId, original.id, [
      { type: "reasoning", text: "think again" },
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
    ])
    expect(nodeParts(edited)).toEqual([
      { type: "reasoning", text: "think again" },
      { type: "text", text: "hello" },
      {
        type: "tool-invocation",
        toolCallId: "c1",
        toolName: "web_search",
        state: "output-available",
        input: { q: "nib" },
        output: "hits",
      },
      { type: "text", text: "world" },
    ])
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
    const edited = await forkEdit(userId, original.id, [
      { type: "text", text: "edited" },
    ])
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
    const backup = await createBackup()
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
    const zip = await createBackupArchive()
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

  it("persists conversation view without bumping updated_at", async () => {
    const chat = await createChat(userId, "View state")
    const node = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "hello" }],
    })
    const before = await getWorkspace(userId, { chatId: chat.id })
    const camera = {
      anchorNodeId: node.id,
      offsetX: 0.1,
      offsetY: -0.2,
      zoom: 0.9,
    }
    await setChatViewState(userId, chat.id, { mode: "tree", camera })
    const workspace = await getWorkspace(userId, { chatId: chat.id })
    expect(parseChatViewState(workspace.chat!.view_state_json)).toEqual({
      mode: "tree",
      camera,
    })
    expect(workspace.chat!.updated_at).toBe(before.chat!.updated_at)
  })

  it("rejects a camera anchored on another conversation", async () => {
    const home = await createChat(userId, "Home")
    const other = await createChat(userId, "Other")
    const node = await insertNode({
      chatId: other.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "elsewhere" }],
    })
    await expect(
      setChatViewState(userId, home.id, {
        mode: "tree",
        camera: {
          anchorNodeId: node.id,
          offsetX: 0,
          offsetY: 0,
          zoom: 0.82,
        },
      })
    ).rejects.toThrow(/anchor/)
  })

  it("clears a deleted camera anchor and keeps the view mode", async () => {
    const chat = await createChat(userId, "Clear camera")
    const node = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "root" }],
    })
    await setChatViewState(userId, chat.id, {
      mode: "tree",
      camera: {
        anchorNodeId: node.id,
        offsetX: 0,
        offsetY: 0,
        zoom: 0.9,
      },
    })
    await deleteNode(userId, node.id, "subtree")
    const workspace = await getWorkspace(userId, { chatId: chat.id })
    expect(parseChatViewState(workspace.chat!.view_state_json)).toEqual({
      mode: "tree",
      camera: null,
    })
  })

  it("seeds new chats from latest chat model config when available", async () => {
    const provider = await createProvider(userId, {
      name: `Seed provider ${Date.now()}`,
      kind: "openai-compatible",
      config: { baseUrl: "http://127.0.0.1:8080/v1", headers: [] },
      models: [
        {
          id: "seed-model",
          label: "seed-model",
          enabled: true,
          source: "custom",
          pdfInput: "extracted",
        },
      ],
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

  it("finishSetup saves a provider, optional title model, and completes onboarding", async () => {
    const result = await finishSetup(userId, {
      provider: {
        name: `Setup provider ${Date.now()}`,
        kind: "openai",
        config: {
          headers: [{ name: "Authorization", value: "Bearer sk-test" }],
        },
        models: [
          {
            id: "gpt-4o",
            enabled: true,
            source: "custom",
            pdfInput: "native",
          },
        ],
      },
      titleModel: "gpt-4o",
    })
    expect(result.ok).toBe(true)
    const title = await getTitleModelConfig()
    expect(title?.model).toBe("gpt-4o")
    const instance = await db
      .selectFrom("instance")
      .select("onboarding_completed_at")
      .where("id", "=", 1)
      .executeTakeFirst()
    expect(instance?.onboarding_completed_at).toBeTruthy()
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
  it("deletes a chat when stream cancellation is unavailable", async () => {
    const chat = await createChat(userId, "Delete despite stream outage")
    const assistant = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "assistant",
      parts: [],
      status: "streaming",
      generationId: crypto.randomUUID(),
    })
    const run = await db
      .selectFrom("generation_runs")
      .select("id")
      .where("node_id", "=", assistant.id)
      .executeTakeFirstOrThrow()
    const requestCancel = vi
      .spyOn(generationStreamStore, "requestCancel")
      .mockRejectedValue(new Error("Redis unavailable"))

    await deleteChat(userId, chat.id)

    expect(requestCancel).toHaveBeenCalledWith(run.id)
    expect(
      await db
        .selectFrom("chats")
        .select("id")
        .where("id", "=", chat.id)
        .executeTakeFirst()
    ).toBeUndefined()
    expect(await getGenerationRun(run.id)).toBeUndefined()
  })

  it("deletes a generation subtree when stream cancellation is unavailable", async () => {
    const chat = await createChat(
      userId,
      "Subtree delete despite stream outage"
    )
    const root = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "root" }],
    })
    const assistant = await insertNode({
      chatId: chat.id,
      parentId: root.id,
      role: "assistant",
      parts: [],
      status: "streaming",
      generationId: crypto.randomUUID(),
    })
    const run = await db
      .selectFrom("generation_runs")
      .select("id")
      .where("node_id", "=", assistant.id)
      .executeTakeFirstOrThrow()
    const requestCancel = vi
      .spyOn(generationStreamStore, "requestCancel")
      .mockRejectedValue(new Error("Redis unavailable"))

    await deleteNode(userId, root.id, "subtree")

    expect(requestCancel).toHaveBeenCalledWith(run.id)
    expect(
      await db
        .selectFrom("message_nodes")
        .select("id")
        .where("id", "=", assistant.id)
        .executeTakeFirst()
    ).toBeUndefined()
    expect(await getGenerationRun(run.id)).toBeUndefined()
  })

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
      parts: [{ type: "text", text: "half reply" }],
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
      parts: [],
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
      parts: [{ type: "text", text: "x" }],
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
      parts: [
        { type: "reasoning", text: "thinking" },
        { type: "text", text: "full reply" },
      ],
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
      parts: [{ type: "text", text: "x" }],
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
      parts: [{ type: "text", text: "should not win" }],
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
      parts: [{ type: "text", text: "first" }],
    })
    const second = await finalizeStreamingAssistant({
      nodeId: assistant.id,
      outcome: "error",
      parts: [{ type: "text", text: "second" }],
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
      parts: [{ type: "text", text: "x" }],
      error: "boom",
    })
    expect(result).toBe("missing")
  })
})

describe("modelFor preflight", () => {
  it("replaces a stale model selection with the first enabled model", async () => {
    const provider = await createProvider(userId, {
      name: `Fallback ${Date.now()}`,
      kind: "openai-compatible",
      config: { headers: [] },
      models: [
        {
          id: "first",
          label: "First",
          enabled: true,
          source: "custom",
          pdfInput: "extracted",
        },
        {
          id: "second",
          label: "Second",
          enabled: true,
          source: "custom",
          pdfInput: "extracted",
        },
      ],
    })
    await expect(
      resolveModelConfig(userId, { providerId: provider.id, model: "removed" })
    ).resolves.toMatchObject({ providerId: provider.id, model: "first" })
  })

  it("requires API key", async () => {
    const provider = await createProvider(userId, {
      name: `No key ${Date.now()}`,
      kind: "openai",
      config: { headers: [] },
      models: [
        {
          id: "gpt-4o-mini",
          label: "gpt-4o-mini",
          enabled: true,
          source: "custom",
          pdfInput: "native",
        },
      ],
    })
    await expect(
      modelFor(userId, { providerId: provider.id, model: "gpt-4o-mini" })
    ).rejects.toThrow(/Authorization header/)
  })

  it("requires base URL for openai-compatible", async () => {
    const provider = await createProvider(userId, {
      name: `No base ${Date.now()}`,
      kind: "openai-compatible",
      config: { headers: [] },
      models: [
        {
          id: "local-model",
          label: "local-model",
          enabled: true,
          source: "custom",
          pdfInput: "extracted",
        },
      ],
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
  it("accepts a minimal current backup", () => {
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
      userId,
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
    const resolved = await resolveStackForChat(chat, userId)
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
    await deletePromptStack(userId, stack.id)
    const afterDelete = await db
      .selectFrom("chats")
      .select("prompt_stack_id")
      .where("id", "=", chat.id)
      .executeTakeFirstOrThrow()
    expect(afterDelete.prompt_stack_id).toBeNull()

    const settings = await getUserSettings(userId)
    await expect(
      deletePromptStack(userId, settings.default_prompt_stack_id)
    ).rejects.toThrow(/default stack/i)
  })
})

describe("provider catalog privacy", () => {
  it("hides provider connection details from the shared catalog", async () => {
    const provider = await createProvider(userId, {
      name: `Catalog privacy ${Date.now()}`,
      kind: "openai-compatible",
      config: {
        baseUrl: "http://127.0.0.1:8080/v1",
        headers: [
          { name: "Authorization", value: "Bearer ${NIBCHAT_TEST_KEY}" },
        ],
      },
      models: [
        {
          id: "privacy-model",
          label: "privacy-model",
          enabled: true,
          source: "custom",
          pdfInput: "extracted",
        },
      ],
    })
    const available = await listAvailableProviders()
    const shared = available.find((row) => row.id === provider.id)
    expect(shared?.config).toEqual({ headers: [] })
    const owned = (await listProviders()).find((row) => row.id === provider.id)
    expect(owned?.config.baseUrl).toBe("http://127.0.0.1:8080/v1")
    expect(owned?.config.headers[0]?.value).toBe("Bearer ${NIBCHAT_TEST_KEY}")
  })
})

describe("multi-user restore", () => {
  it("restores a guest user as disabled without leaking owner chats", async () => {
    await db.deleteFrom("chats").execute()
    await db.deleteFrom("user").where("id", "!=", userId).execute()
    await restoreBackup(userId, multiUserBackup("guest-restore@test.local"))
    const guest = await db
      .selectFrom("user")
      .selectAll()
      .where("id", "=", "src-guest")
      .executeTakeFirstOrThrow()
    expect(Boolean(guest.banned)).toBe(true)
    expect(guest.role).toBe("user")
    const ownerChat = await db
      .selectFrom("chats")
      .select("user_id")
      .where("id", "=", "oc")
      .executeTakeFirstOrThrow()
    expect(ownerChat.user_id).toBe(userId)
    const guestChat = await db
      .selectFrom("chats")
      .select("user_id")
      .where("id", "=", "gc")
      .executeTakeFirstOrThrow()
    expect(guestChat.user_id).toBe("src-guest")
    const guestNode = await db
      .selectFrom("message_nodes")
      .select("id")
      .where("id", "=", "gn")
      .executeTakeFirst()
    expect(guestNode?.id).toBe("gn")
    const guestPrefs = await db
      .selectFrom("user_preferences")
      .select("builtin_tools_json")
      .where("user_id", "=", "src-guest")
      .executeTakeFirstOrThrow()
    expect(guestPrefs.builtin_tools_json).toBe(
      JSON.stringify({ disabled: ["question"] })
    )
    const ownerPrefs = await db
      .selectFrom("user_preferences")
      .select("builtin_tools_json")
      .where("user_id", "=", userId)
      .executeTakeFirstOrThrow()
    expect(ownerPrefs.builtin_tools_json).toBe(JSON.stringify({ disabled: [] }))
  })

  it("rolls back owner rows when guest restore fails", async () => {
    await db.deleteFrom("chats").execute()
    await db.deleteFrom("user").where("id", "!=", userId).execute()
    await expect(
      restoreBackup(userId, multiUserBackup("owner@test.local"))
    ).rejects.toThrow()
    expect(
      await db.selectFrom("chats").select("id").executeTakeFirst()
    ).toBeUndefined()
    expect(
      await db
        .selectFrom("user")
        .select("id")
        .where("id", "=", "src-guest")
        .executeTakeFirst()
    ).toBeUndefined()
  })
})

describe("generation run reconciliation", () => {
  it("finalizes a stale starting run whose stream store never opened", async () => {
    const chat = await createChat(userId, "Stale starting")
    const generationId = crypto.randomUUID()
    const assistant = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "assistant",
      parts: [{ type: "text", text: "partial" }],
      status: "streaming",
      generationId,
    })
    await db
      .updateTable("generation_runs")
      .set({ started_at: new Date(Date.now() - 60_000).toISOString() })
      .where("id", "=", generationId)
      .execute()

    const workspace = await getWorkspace(userId, { chatId: chat.id })
    expect(workspace.activeGenerations).toEqual([])
    expect(
      workspace.nodes.find((node) => node.id === assistant.id)?.status
    ).toBe("error")
    expect(await getGenerationRun(generationId)).toBeUndefined()
  })

  it("leaves a young starting run alone during the store hand-off", async () => {
    const chat = await createChat(userId, "Young starting")
    const generationId = crypto.randomUUID()
    const assistant = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "assistant",
      parts: [],
      status: "streaming",
      generationId,
    })
    const workspace = await getWorkspace(userId, { chatId: chat.id })
    expect(workspace.activeGenerations.map((run) => run.generationId)).toEqual([
      generationId,
    ])
    expect(
      workspace.nodes.find((node) => node.id === assistant.id)?.status
    ).toBe("streaming")
    expect(await getGenerationRun(generationId)).toMatchObject({
      state: "starting",
    })
  })

  it("does not recover an open stream even when the run is old", async () => {
    const chat = await createChat(userId, "Open lease")
    const generationId = crypto.randomUUID()
    const assistant = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "assistant",
      parts: [],
      status: "streaming",
      generationId,
    })
    await generationStreamStore.open({
      generationId,
      nodeId: assistant.id,
      chatId: chat.id,
      parentNodeId: null,
    })
    await db
      .updateTable("generation_runs")
      .set({
        state: "active",
        started_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .where("id", "=", generationId)
      .execute()
    try {
      const workspace = await getWorkspace(userId, { chatId: chat.id })
      expect(workspace.activeGenerations).toHaveLength(1)
      expect(
        workspace.nodes.find((node) => node.id === assistant.id)?.status
      ).toBe("streaming")
    } finally {
      await generationStreamStore.discard(generationId)
    }
  })

  it("retries leftover recovering rows and removes the run", async () => {
    const chat = await createChat(userId, "Stuck recovering")
    const generationId = crypto.randomUUID()
    const assistant = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "assistant",
      parts: [{ type: "text", text: "kept" }],
      status: "streaming",
      generationId,
    })
    await db
      .updateTable("generation_runs")
      .set({
        state: "recovering",
        started_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .where("id", "=", generationId)
      .execute()

    const workspace = await getWorkspace(userId, { chatId: chat.id })
    expect(workspace.activeGenerations).toEqual([])
    expect(
      workspace.nodes.find((node) => node.id === assistant.id)?.status
    ).toBe("error")
    expect(await getGenerationRun(generationId)).toBeUndefined()
  })

  it("drops a leftover run when the node is already terminal", async () => {
    const chat = await createChat(userId, "Superseded run")
    const generationId = crypto.randomUUID()
    const assistant = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "assistant",
      parts: [{ type: "text", text: "done" }],
      status: "streaming",
      generationId,
    })
    await db
      .updateTable("message_nodes")
      .set({ status: "complete" })
      .where("id", "=", assistant.id)
      .execute()

    const result = await finalizeStreamingAssistant({
      nodeId: assistant.id,
      generationId,
      outcome: "error",
      parts: [{ type: "text", text: "should not win" }],
    })
    expect(result).toBe("superseded")
    expect(await getGenerationRun(generationId)).toBeUndefined()
  })
})

function fixtureUser(id: string, email: string, role: string) {
  return {
    id,
    name: id,
    email,
    emailVerified: true,
    role,
    banned: false,
    banReason: null,
    banExpires: null,
    createdAt: "t",
    updatedAt: "t",
  }
}

function fixtureTheme(
  id: string,
  ownerId: string,
  seed: (typeof SEED_THEMES)[number]
) {
  return {
    id,
    user_id: ownerId,
    name: seed.name,
    document: seed.document,
    created_at: "t",
    updated_at: "t",
  }
}

function fixtureStack(id: string, ownerId: string) {
  return {
    id,
    user_id: ownerId,
    name: "Default",
    stack_json: promptStackToJson(defaultPromptStack()),
    created_at: "t",
    updated_at: "t",
  }
}

function fixturePrefs(
  ownerId: string,
  light: string,
  dark: string,
  stack: string,
  builtinToolsJson = JSON.stringify({ disabled: [] })
) {
  return {
    user_id: ownerId,
    light_theme_id: light,
    dark_theme_id: dark,
    default_prompt_stack_id: stack,
    theme_mode: "system" as const,
    builtin_tools_json: builtinToolsJson,
    created_at: "t",
    updated_at: "t",
  }
}

function fixtureChat(id: string, ownerId: string) {
  return {
    id,
    user_id: ownerId,
    title: id,
    selected_root_node_id: null,
    model_config_json: "{}",
    view_state_json: '{"mode":"linear","camera":null}',
    prompt_stack_id: null,
    created_at: "t",
    updated_at: "t",
  }
}

function fixtureNode(id: string, chatId: string) {
  return {
    id,
    chat_id: chatId,
    parent_id: null,
    selected_child_id: null,
    role: "user" as const,
    parts_json: "[]",
    search_text: "",
    metadata_json: "{}",
    excluded_from_context: false,
    status: "complete" as const,
    created_at: "t",
    updated_at: "t",
  }
}

function multiUserBackup(guestEmail: string) {
  const owner = "src-owner"
  const guest = "src-guest"
  const paper = SEED_THEMES.find((theme) => theme.id === "paper")
  const ink = SEED_THEMES.find((theme) => theme.id === "ink")
  if (!paper || !ink) throw new Error("Seed themes missing")
  return {
    version: 1 as const,
    users: [
      fixtureUser(owner, "backup-owner@test.local", "admin"),
      fixtureUser(guest, guestEmail, "user"),
    ],
    themes: [
      fixtureTheme("ot-light", owner, paper),
      fixtureTheme("ot-dark", owner, ink),
      fixtureTheme("gt-light", guest, paper),
      fixtureTheme("gt-dark", guest, ink),
    ],
    promptStacks: [fixtureStack("os", owner), fixtureStack("gs", guest)],
    userPreferences: [
      fixturePrefs(owner, "ot-light", "ot-dark", "os"),
      fixturePrefs(
        guest,
        "gt-light",
        "gt-dark",
        "gs",
        JSON.stringify({ disabled: ["question"] })
      ),
    ],
    chats: [fixtureChat("oc", owner), fixtureChat("gc", guest)],
    nodes: [fixtureNode("on", "oc"), fixtureNode("gn", "gc")],
  }
}
