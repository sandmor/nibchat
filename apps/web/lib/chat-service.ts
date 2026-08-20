import "server-only"
import { createHash } from "node:crypto"
import { sql } from "kysely"
import { db, databaseKind } from "@/lib/db"
import {
  ancestorPath,
  id,
  now,
  parseJson,
  resolveActivePath,
  subtreeNodeIds,
} from "@/lib/domain"
import {
  isEmptyParts,
  partsFromTextReasoning,
  searchTextFromParts,
} from "@/lib/agent/parts"
import { abortGenerations } from "@/lib/active-generations"
import type {
  MessageRole,
  MessageStatus,
  AttachmentPart,
  NodeRow,
  Parts,
  PromptStackRow,
  ThemeRow,
} from "@/lib/types"
import { generateChatTitle } from "@/lib/agent/generate-title"
import { seedChatTitle } from "@/lib/chat-title"
import { defaultModelConfig, type ModelConfig } from "@/lib/providers"
import { orderNodesForInsert, parseBackup } from "@/lib/backup"
import {
  isEnabledModelId,
  parseProviderModels,
  parseProviderModelsJson,
  providerModelsToJson,
} from "@/lib/provider-models"
import { mcpProfileForBackup, profileFromRow } from "@/lib/mcp"
import {
  appearanceToJson,
  INK_THEME_ID,
  PAPER_THEME_ID,
  parseAppearance,
  type Appearance,
  type ThemeRecord,
} from "@/lib/appearance"
import {
  defaultPromptStack,
  promptStackToJson,
  readStackJson,
  requirePromptStack,
  resolvePromptStack,
  type PromptStackDocument,
} from "@/lib/prompt-stack"
import {
  claimUploadedAttachments,
  cleanupDetachedAttachments,
  readAttachment,
} from "@/lib/attachments"
import { attachmentStorage } from "@/lib/attachments/default-port"
import {
  attachmentArchivePath,
  packBackupArchive,
  unpackBackupArchive,
} from "@/lib/backup-archive"
import { completeOnboarding } from "@/lib/identity/adapters/kysely-instance"
import { validateImageSignature } from "@/lib/file-signatures"

/** SQLite drivers reject JS booleans; Postgres wants real booleans. */
function toDbBool(value: boolean): boolean {
  if (databaseKind === "sqlite") return (value ? 1 : 0) as unknown as boolean
  return value
}

function fromDbBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1"
}

function normalizeNodeRow(node: NodeRow): NodeRow {
  return {
    ...node,
    excluded_from_context: fromDbBool(node.excluded_from_context),
  }
}

async function assertChatOwner(chatId: string, userId: string) {
  const chat = await db
    .selectFrom("chats")
    .select("id")
    .where("id", "=", chatId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!chat) throw new Error("Chat not found")
  return chat
}

async function assertNodeOwner(nodeId: string, userId: string) {
  const row = await db
    .selectFrom("message_nodes")
    .innerJoin("chats", "chats.id", "message_nodes.chat_id")
    .select([
      "message_nodes.id",
      "message_nodes.chat_id",
      "message_nodes.parent_id",
      "message_nodes.selected_child_id",
      "message_nodes.role",
      "message_nodes.parts_json",
      "message_nodes.search_text",
      "message_nodes.metadata_json",
      "message_nodes.excluded_from_context",
      "message_nodes.status",
      "message_nodes.created_at",
      "message_nodes.updated_at",
    ])
    .where("message_nodes.id", "=", nodeId)
    .where("chats.user_id", "=", userId)
    .executeTakeFirst()
  if (!row) throw new Error("Node not found")
  return normalizeNodeRow(row as NodeRow)
}

export async function getWorkspace(
  userId: string,
  input?: { chatId?: string; draft?: boolean }
) {
  const chats = await db
    .selectFrom("chats")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("updated_at", "desc")
    .execute()
  let selected = input?.draft
    ? undefined
    : input?.chatId
      ? chats.find((chat) => chat.id === input.chatId)
      : chats[0]
  // Explicit chatId miss falls back to none, not a different conversation
  if (input?.chatId && !selected) selected = undefined
  const nodes = selected
    ? await db
        .selectFrom("message_nodes")
        .selectAll()
        .where("chat_id", "=", selected.id)
        .orderBy("created_at")
        .execute()
    : []
  return {
    chats,
    chat: selected ?? null,
    nodes: nodes.map((node) => normalizeNodeRow(node)),
  }
}

export async function createChat(
  userId: string,
  title: string | null = null,
  config?: ModelConfig,
  promptStackId?: string | null
) {
  const resolved =
    config && (config.providerId || config.model)
      ? config
      : await defaultModelConfig(userId)
  if (promptStackId) {
    const existing = await db
      .selectFrom("prompt_stacks")
      .select("id")
      .where("id", "=", promptStackId)
      .executeTakeFirst()
    if (!existing) throw new Error("Prompt stack not found")
  }
  const timestamp = now()
  const chat = {
    id: id(),
    user_id: userId,
    title,
    selected_root_node_id: null,
    model_config_json: JSON.stringify(resolved),
    prompt_stack_id: promptStackId ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  }
  await db.insertInto("chats").values(chat).execute()
  return chat
}

export async function deleteChat(userId: string, chatId: string) {
  await assertChatOwner(chatId, userId)
  const nodeIds = await db
    .selectFrom("message_nodes")
    .select("id")
    .where("chat_id", "=", chatId)
    .execute()
  abortGenerations(nodeIds.map((row) => row.id))
  await db
    .deleteFrom("chats")
    .where("id", "=", chatId)
    .where("user_id", "=", userId)
    .execute()
  await cleanupDetachedAttachments()
}

export async function insertNode(input: {
  chatId: string
  parentId: string | null
  role: MessageRole
  parts: Parts
  metadata?: Record<string, unknown>
  status?: MessageStatus
  /** When false, only insert the row — do not rewire view selection. Default true. */
  attachSelection?: boolean
}) {
  const timestamp = now()
  const attachSelection = input.attachSelection !== false
  const node = {
    id: id(),
    chat_id: input.chatId,
    parent_id: input.parentId,
    selected_child_id: null,
    role: input.role,
    parts_json: JSON.stringify(input.parts),
    search_text: searchTextFromParts(input.parts),
    metadata_json: JSON.stringify(input.metadata ?? {}),
    excluded_from_context: toDbBool(false),
    status: input.status ?? ("complete" as const),
    created_at: timestamp,
    updated_at: timestamp,
  }
  await db.transaction().execute(async (trx) => {
    await trx.insertInto("message_nodes").values(node).execute()
    if (!attachSelection) return
    if (input.parentId)
      await trx
        .updateTable("message_nodes")
        .set({ selected_child_id: node.id, updated_at: timestamp })
        .where("id", "=", input.parentId)
        .execute()
    else
      await trx
        .updateTable("chats")
        .set({ selected_root_node_id: node.id, updated_at: timestamp })
        .where("id", "=", input.chatId)
        .execute()
  })
  return node
}

type InsertableNode = {
  id: string
  chat_id: string
  parent_id: string | null
  selected_child_id: null
  role: MessageRole
  parts_json: string
  search_text: string
  metadata_json: string
  excluded_from_context: boolean
  status: "complete" | "streaming" | "stopped" | "error"
  created_at: string
  updated_at: string
}

function newNode(
  input: {
    chatId: string
    parentId: string | null
    role: MessageRole
    parts: Parts
    metadata?: Record<string, unknown>
    status?: InsertableNode["status"]
  },
  timestamp = now()
): InsertableNode {
  return {
    id: id(),
    chat_id: input.chatId,
    parent_id: input.parentId,
    selected_child_id: null,
    role: input.role,
    parts_json: JSON.stringify(input.parts),
    search_text: searchTextFromParts(input.parts),
    metadata_json: JSON.stringify(input.metadata ?? {}),
    excluded_from_context: toDbBool(false),
    status: input.status ?? "complete",
    created_at: timestamp,
    updated_at: timestamp,
  }
}

/**
 * Creates the user message and streaming assistant under an explicit parent.
 * View selection (selected_root / selected_child) is not updated — generation
 * placement is purely structural; the client may soft-follow if still on tip.
 */
export async function createTurn(input: {
  userId: string
  chatId: string
  parentId: string | null
  content: string
  /** Optional attachments ahead of the user text (MCP resources, future files). */
  attachments?: AttachmentPart[]
  assistantMetadata: Record<string, unknown>
}) {
  if (input.parentId) {
    const parent = await db
      .selectFrom("message_nodes")
      .select("id")
      .where("id", "=", input.parentId)
      .where("chat_id", "=", input.chatId)
      .executeTakeFirst()
    if (!parent) throw new Error("Parent node not found in chat")
  }
  const timestamp = now()
  const text = input.content.trim()
  const attachments = input.attachments ?? []
  if (!text && attachments.length === 0) throw new Error("Message is required")
  const parts: Parts = [
    ...attachments,
    ...(text ? [{ type: "text" as const, text }] : []),
  ]
  const user = newNode(
    {
      chatId: input.chatId,
      parentId: input.parentId,
      role: "user",
      parts,
    },
    timestamp
  )
  const assistant = newNode(
    {
      chatId: input.chatId,
      parentId: user.id,
      role: "assistant",
      parts: [],
      status: "streaming",
      metadata: input.assistantMetadata,
    },
    timestamp
  )
  await db.transaction().execute(async (trx) => {
    await trx.insertInto("message_nodes").values(user).execute()
    await claimUploadedAttachments(input.userId, user.id, attachments, trx)
    await trx.insertInto("message_nodes").values(assistant).execute()
  })
  return { user, assistant }
}

export async function updateNode(
  nodeId: string,
  parts: Parts,
  status?: MessageStatus
) {
  await db
    .updateTable("message_nodes")
    .set({
      parts_json: JSON.stringify(parts),
      search_text: searchTextFromParts(parts),
      ...(status ? { status } : {}),
      updated_at: now(),
    })
    .where("id", "=", nodeId)
    .execute()
}

/** Keep a node visible in the tree while opting it in or out of future model context. */
export async function setNodeContextExcluded(
  userId: string,
  nodeId: string,
  excluded: boolean
) {
  await assertNodeOwner(nodeId, userId)
  await db
    .updateTable("message_nodes")
    .set({ excluded_from_context: toDbBool(excluded), updated_at: now() })
    .where("id", "=", nodeId)
    .execute()
}

export async function updateChat(
  chatId: string,
  patch: {
    title?: string
    model?: ModelConfig
  },
  userId?: string
) {
  if (userId) await assertChatOwner(chatId, userId)
  await db
    .updateTable("chats")
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.model
        ? { model_config_json: JSON.stringify(patch.model) }
        : {}),
      updated_at: now(),
    })
    .where("id", "=", chatId)
    .execute()
}

export type TitleModelConfig = {
  providerId: string
  model: string
}

function readTitleModelConfig(
  raw: string | null | undefined
): TitleModelConfig | null {
  if (!raw) return null
  const parsed = parseJson<{ providerId?: string; model?: string }>(raw, {})
  const providerId = parsed.providerId?.trim()
  const model = parsed.model?.trim()
  if (!providerId || !model) return null
  return { providerId, model }
}

async function readStoredTitleModelConfig() {
  const row = await db
    .selectFrom("instance")
    .select("title_model_config_json")
    .where("id", "=", 1)
    .executeTakeFirst()
  return readTitleModelConfig(row?.title_model_config_json)
}

/** Effective title model. Does not persist when the stored model is unavailable. */
export async function getTitleModelConfig() {
  const config = await readStoredTitleModelConfig()
  if (!config) return null
  if (await titleModelIsAvailable(config)) return config
  return null
}

async function clearTitleModelIfUnavailable() {
  const config = await readStoredTitleModelConfig()
  if (!config) return
  if (await titleModelIsAvailable(config)) return
  await db
    .updateTable("instance")
    .set({ title_model_config_json: null })
    .where("id", "=", 1)
    .where("title_model_config_json", "is not", null)
    .execute()
}

async function titleModelIsAvailable(config: TitleModelConfig) {
  const profile = await db
    .selectFrom("provider_profiles")
    .select("models_json")
    .where("id", "=", config.providerId)
    .executeTakeFirst()
  if (!profile) return false
  return isEnabledModelId(
    parseProviderModelsJson(profile.models_json),
    config.model
  )
}

/** Write a title only while the chat is still unnamed. */
export async function assignChatTitleIfUnnamed(chatId: string, title: string) {
  const trimmed = title.trim()
  if (!trimmed) return
  await db
    .updateTable("chats")
    .set({ title: trimmed, updated_at: now() })
    .where("id", "=", chatId)
    .where("title", "is", null)
    .execute()
}

export async function maybeAssignChatTitle(input: {
  chatId: string
  userId: string
  userText: string
  attachmentNames: string[]
  assistantText?: string
  allowLlm: boolean
}) {
  const seed = seedChatTitle(input.userText, input.attachmentNames)
  if (input.allowLlm) {
    const config = await getTitleModelConfig()
    if (config) {
      try {
        const generated = await generateChatTitle({
          userId: input.userId,
          config,
          userText: input.userText.trim() || seed,
          assistantText: input.assistantText,
        })
        await assignChatTitleIfUnnamed(input.chatId, generated)
        return
      } catch (error) {
        console.warn("[nibchat/title]", error)
      }
    }
  }
  await assignChatTitleIfUnnamed(input.chatId, seed)
}

export async function setInstanceTitleModel(config: TitleModelConfig | null) {
  await db
    .updateTable("instance")
    .set({
      title_model_config_json: config
        ? JSON.stringify({
            providerId: config.providerId,
            model: config.model,
          })
        : null,
    })
    .where("id", "=", 1)
    .execute()
  return { ok: true as const, titleModelConfig: config }
}

export async function searchChats(userId: string, query: string) {
  const trimmed = query.trim()
  if (!trimmed) return []
  const pattern = `%${escapeLike(trimmed)}%`
  return db
    .selectFrom("message_nodes")
    .innerJoin("chats", "chats.id", "message_nodes.chat_id")
    .select([
      "message_nodes.id",
      "message_nodes.chat_id",
      "message_nodes.search_text",
      "chats.title",
    ])
    .where("chats.user_id", "=", userId)
    .where(sql<boolean>`message_nodes.search_text like ${pattern} escape '\\'`)
    .limit(50)
    .execute()
}

function escapeLike(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
}

export function nodeParts(node: NodeRow): Parts {
  return parseJson<Parts>(node.parts_json, [])
}

export async function selectChild(
  userId: string,
  nodeId: string,
  childId: string | null
) {
  await assertNodeOwner(nodeId, userId)
  if (childId) {
    const child = await assertNodeOwner(childId, userId)
    if (child.parent_id !== nodeId)
      throw new Error("Selected child must be a direct child of this node")
  }
  await db
    .updateTable("message_nodes")
    .set({ selected_child_id: childId, updated_at: now() })
    .where("id", "=", nodeId)
    .execute()
}

export async function selectRoot(
  userId: string,
  chatId: string,
  nodeId: string
) {
  await assertChatOwner(chatId, userId)
  await assertNodeOwner(nodeId, userId)
  await db
    .updateTable("chats")
    .set({ selected_root_node_id: nodeId, updated_at: now() })
    .where("id", "=", chatId)
    .where("user_id", "=", userId)
    .execute()
}

export async function selectPath(
  userId: string,
  chatId: string,
  nodeId: string
) {
  await assertChatOwner(chatId, userId)
  const nodes = await db
    .selectFrom("message_nodes")
    .selectAll()
    .where("chat_id", "=", chatId)
    .execute()
  const byId = new Map(nodes.map((node) => [node.id, node]))
  if (!byId.has(nodeId)) throw new Error("Node not found")
  const path: NodeRow[] = []
  let current: NodeRow | undefined = byId.get(nodeId)
  while (current) {
    path.unshift(current)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  const timestamp = now()
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable("chats")
      .set({
        selected_root_node_id: path[0]?.id ?? null,
        updated_at: timestamp,
      })
      .where("id", "=", chatId)
      .where("user_id", "=", userId)
      .execute()
    for (let index = 0; index < path.length - 1; index++) {
      const parent = path[index]
      const child = path[index + 1]
      if (parent && child)
        await trx
          .updateTable("message_nodes")
          .set({ selected_child_id: child.id, updated_at: timestamp })
          .where("id", "=", parent.id)
          .execute()
    }
  })
}

export async function forkEdit(
  userId: string,
  nodeId: string,
  text: string,
  options: { attachSelection?: boolean } = {}
) {
  const original = await assertNodeOwner(nodeId, userId)
  const originalParts = nodeParts(original)
  const parts: Parts = [
    ...originalParts.filter((part) => part.type === "attachment"),
    { type: "text", text: text.trim() },
  ]
  if (!text.trim()) throw new Error("Message is required")
  const timestamp = now()
  const node = newNode(
    {
      chatId: original.chat_id,
      parentId: original.parent_id,
      role: original.role,
      parts,
      metadata: {
        ...parseJson<Record<string, unknown>>(original.metadata_json, {}),
        provenance: "owner-edited",
        editedFrom: original.id,
      },
    },
    timestamp
  )
  const attachmentIds = parts.flatMap((part) =>
    part.type === "attachment" && part.content.kind === "binary"
      ? [part.content.attachmentId]
      : []
  )
  await db.transaction().execute(async (trx) => {
    await trx.insertInto("message_nodes").values(node).execute()
    if (attachmentIds.length)
      await trx
        .insertInto("message_attachments")
        .values(
          attachmentIds.map((attachment_id) => ({
            message_node_id: node.id,
            attachment_id,
          }))
        )
        .execute()
    if (options.attachSelection === false) return
    if (node.parent_id)
      await trx
        .updateTable("message_nodes")
        .set({ selected_child_id: node.id, updated_at: timestamp })
        .where("id", "=", node.parent_id)
        .execute()
    else
      await trx
        .updateTable("chats")
        .set({ selected_root_node_id: node.id, updated_at: timestamp })
        .where("id", "=", node.chat_id)
        .execute()
  })
  return node
}

/** New streaming assistant as a sibling of an existing assistant (any parent role). */
export async function startRegenerate(
  userId: string,
  assistantNodeId: string,
  assistantMetadata: Record<string, unknown> = {}
) {
  const original = await assertNodeOwner(assistantNodeId, userId)
  if (original.role !== "assistant")
    throw new Error("Only assistant messages can be regenerated.")
  const assistant = await insertNode({
    chatId: original.chat_id,
    parentId: original.parent_id,
    role: "assistant",
    parts: [],
    status: "streaming",
    metadata: assistantMetadata,
    attachSelection: false,
  })
  return {
    assistant,
    contextLeafId: original.parent_id as string | null,
  }
}

/** New streaming assistant as a child of any parent node. */
export async function startGenerate(
  userId: string,
  parentNodeId: string,
  assistantMetadata: Record<string, unknown> = {}
) {
  const parent = await assertNodeOwner(parentNodeId, userId)
  const assistant = await insertNode({
    chatId: parent.chat_id,
    parentId: parent.id,
    role: "assistant",
    parts: [],
    status: "streaming",
    metadata: assistantMetadata,
    attachSelection: false,
  })
  return {
    assistant,
    contextLeafId: parent.id as string,
  }
}

export type StreamFinalizeOutcome =
  | "complete"
  | "awaiting_input"
  | "aborted"
  | "error"

export type StreamFinalizeResult =
  | "complete"
  | "awaiting_input"
  | "stopped"
  | "deleted"
  | "error"
  | "missing"
  | "superseded"

export type StreamFinalizeInput = {
  nodeId: string
  outcome: StreamFinalizeOutcome
  /** Preferred: full ordered parts for multi-stage turns. */
  parts?: Parts
  /** Backward-compat partials when `parts` is omitted. */
  text?: string
  reasoning?: string
  usage?: unknown
  finishReason?: string
  error?: string
  config?: ModelConfig
  previousMetadata?: Record<string, unknown>
  /**
   * When true (default for complete), always write a text part even if empty.
   * Awaiting_input keeps empty text optional.
   */
  forceTextPart?: boolean
  /** Allowed starting statuses (default: streaming only). Resume may use awaiting_input. */
  fromStatuses?: MessageStatus[]
}

/**
 * Update parts/status only while the node is in an allowed in-flight status.
 * Returns false if the row is missing or already finalized (or cascade-deleted).
 */
async function updateStreamingNode(
  nodeId: string,
  parts: Parts,
  status: MessageStatus,
  fromStatuses: MessageStatus[] = ["streaming"]
): Promise<boolean> {
  let query = db
    .updateTable("message_nodes")
    .set({
      parts_json: JSON.stringify(parts),
      search_text: searchTextFromParts(parts),
      status,
      updated_at: now(),
    })
    .where("id", "=", nodeId)
  if (fromStatuses.length === 1) {
    query = query.where("status", "=", fromStatuses[0]!)
  } else {
    query = query.where("status", "in", fromStatuses)
  }
  const result = await query.executeTakeFirst()
  return Number(result.numUpdatedRows ?? 0) > 0
}

function resolveFinalizeParts(input: StreamFinalizeInput): Parts {
  if (input.parts) return input.parts
  const text = input.text ?? ""
  const reasoning = (input.reasoning ?? "").trim()
  if (input.outcome === "complete" && input.forceTextPart !== false) {
    return [
      ...(reasoning ? [{ type: "reasoning" as const, text: reasoning }] : []),
      { type: "text" as const, text },
    ]
  }
  return partsFromTextReasoning(text.trim(), reasoning)
}

/**
 * Single write path for stream terminal outcomes.
 * Idempotent: only mutates rows still in `fromStatuses` (default streaming).
 * Returns "missing" if cascade-deleted, "superseded" if already finalized.
 */
export async function finalizeStreamingAssistant(
  input: StreamFinalizeInput
): Promise<StreamFinalizeResult> {
  const fromStatuses = input.fromStatuses ?? ["streaming"]
  const row = await db
    .selectFrom("message_nodes")
    .select(["id", "chat_id", "status", "metadata_json"])
    .where("id", "=", input.nodeId)
    .executeTakeFirst()
  if (!row) return "missing"
  if (!(fromStatuses as string[]).includes(row.status)) return "superseded"

  const parts = resolveFinalizeParts(input)
  const previous = {
    ...parseJson<Record<string, unknown>>(row.metadata_json, {}),
    ...(input.previousMetadata ?? {}),
  }
  const config = input.config

  if (input.outcome === "aborted") {
    if (isEmptyParts(parts)) {
      return deleteStreamingShell(input.nodeId)
    }
    const updated = await updateStreamingNode(
      input.nodeId,
      parts,
      "stopped",
      fromStatuses
    )
    return updated ? "stopped" : "superseded"
  }

  if (input.outcome === "error") {
    const updated = await updateStreamingNode(
      input.nodeId,
      parts,
      "error",
      fromStatuses
    )
    if (!updated) return "superseded"
    await db
      .updateTable("message_nodes")
      .set({
        metadata_json: JSON.stringify({
          ...previous,
          ...(config?.providerId != null
            ? { provider: config.providerId }
            : {}),
          ...(config?.model != null ? { model: config.model } : {}),
          ...(input.error != null ? { error: input.error } : {}),
          errorAt: new Date().toISOString(),
        }),
        updated_at: now(),
      })
      .where("id", "=", input.nodeId)
      .execute()
    return "error"
  }

  if (input.outcome === "awaiting_input") {
    const updated = await updateStreamingNode(
      input.nodeId,
      parts,
      "awaiting_input",
      fromStatuses
    )
    if (!updated) return "superseded"
    await db
      .updateTable("message_nodes")
      .set({
        metadata_json: JSON.stringify({
          ...previous,
          ...(config?.providerId != null
            ? { provider: config.providerId }
            : {}),
          ...(config?.model != null ? { model: config.model } : {}),
          pausedAt: new Date().toISOString(),
          ...(input.finishReason != null
            ? { finishReason: input.finishReason }
            : {}),
          ...(input.usage !== undefined ? { usage: input.usage } : {}),
          ...(config ? { params: config } : {}),
        }),
        updated_at: now(),
      })
      .where("id", "=", input.nodeId)
      .execute()
    return "awaiting_input"
  }

  // complete
  const updated = await updateStreamingNode(
    input.nodeId,
    parts,
    "complete",
    fromStatuses
  )
  if (!updated) return "superseded"
  await db
    .updateTable("message_nodes")
    .set({
      metadata_json: JSON.stringify({
        ...previous,
        ...(config?.providerId != null ? { provider: config.providerId } : {}),
        ...(config?.model != null ? { model: config.model } : {}),
        finishedAt: new Date().toISOString(),
        ...(input.finishReason != null
          ? { finishReason: input.finishReason }
          : {}),
        ...(input.usage !== undefined ? { usage: input.usage } : {}),
        ...(config ? { params: config } : {}),
      }),
      updated_at: now(),
    })
    .where("id", "=", input.nodeId)
    .execute()
  return "complete"
}

/**
 * Apply tool outputs on an awaiting_input assistant and mark as streaming for resume.
 * CAS: only transitions from awaiting_input → streaming.
 */
export async function beginResumeAssistant(
  nodeId: string,
  parts: Parts
): Promise<"streaming" | "missing" | "superseded"> {
  const row = await db
    .selectFrom("message_nodes")
    .select(["id", "status"])
    .where("id", "=", nodeId)
    .executeTakeFirst()
  if (!row) return "missing"
  if (row.status !== "awaiting_input") return "superseded"
  const result = await db
    .updateTable("message_nodes")
    .set({
      parts_json: JSON.stringify(parts),
      search_text: searchTextFromParts(parts),
      status: "streaming",
      updated_at: now(),
    })
    .where("id", "=", nodeId)
    .where("status", "=", "awaiting_input")
    .executeTakeFirst()
  return Number(result.numUpdatedRows ?? 0) > 0 ? "streaming" : "superseded"
}

/**
 * Undo a failed resume claim: restore original parts and awaiting_input only
 * while the node is still streaming (setup failed before/around stream start).
 */
export async function restoreAwaitingInput(
  nodeId: string,
  originalParts: Parts
): Promise<"awaiting_input" | "missing" | "superseded"> {
  const row = await db
    .selectFrom("message_nodes")
    .select(["id", "status"])
    .where("id", "=", nodeId)
    .executeTakeFirst()
  if (!row) return "missing"
  if (row.status !== "streaming") return "superseded"
  const result = await db
    .updateTable("message_nodes")
    .set({
      parts_json: JSON.stringify(originalParts),
      search_text: searchTextFromParts(originalParts),
      status: "awaiting_input",
      updated_at: now(),
    })
    .where("id", "=", nodeId)
    .where("status", "=", "streaming")
    .executeTakeFirst()
  return Number(result.numUpdatedRows ?? 0) > 0
    ? "awaiting_input"
    : "superseded"
}

/**
 * Delete an empty streaming assistant shell (leaf only) and repair selection.
 * Defensive: if children exist, do not cascade — return superseded.
 */
async function deleteStreamingShell(
  nodeId: string
): Promise<"deleted" | "missing" | "superseded"> {
  const node = await db
    .selectFrom("message_nodes")
    .selectAll()
    .where("id", "=", nodeId)
    .executeTakeFirst()
  if (!node) return "missing"
  if (node.status !== "streaming") return "superseded"

  const children = await db
    .selectFrom("message_nodes")
    .select("id")
    .where("parent_id", "=", node.id)
    .execute()
  if (children.length > 0) {
    console.warn(
      "[nibchat] deleteStreamingShell: assistant has children; skipping",
      nodeId
    )
    return "superseded"
  }

  await deleteSingleNodeWithSelectionRepair(node)
  return "deleted"
}

/** Abort-only convenience wrapper (kept for tests / call sites). */
export async function finalizeAbortedAssistant(
  nodeId: string,
  partial: { text?: string; reasoning?: string; parts?: Parts }
): Promise<"stopped" | "deleted" | "missing" | "superseded"> {
  const result = await finalizeStreamingAssistant({
    nodeId,
    outcome: "aborted",
    parts: partial.parts,
    text: partial.text,
    reasoning: partial.reasoning,
  })
  if (
    result === "complete" ||
    result === "error" ||
    result === "awaiting_input"
  )
    return "superseded"
  return result
}

export async function deleteNode(
  userId: string,
  nodeId: string,
  mode: "subtree" | "reparent"
) {
  const node = await assertNodeOwner(nodeId, userId)

  if (mode === "reparent") {
    abortGenerations([node.id])
    await deleteNodeInternal(node.id, node.chat_id, "reparent")
    await cleanupDetachedAttachments()
    return
  }

  // Subtree: abort every live generation under this root, then CASCADE delete.
  const chatNodes = await db
    .selectFrom("message_nodes")
    .select(["id", "parent_id"])
    .where("chat_id", "=", node.chat_id)
    .execute()
  abortGenerations(subtreeNodeIds(chatNodes, node.id))
  await deleteNodeInternal(node.id, node.chat_id, "subtree")
  await cleanupDetachedAttachments()
}

/**
 * Structural delete without ownership checks (used after assertNodeOwner).
 */
async function deleteNodeInternal(
  nodeId: string,
  chatId: string,
  mode: "subtree" | "reparent"
) {
  const node = await db
    .selectFrom("message_nodes")
    .selectAll()
    .where("id", "=", nodeId)
    .where("chat_id", "=", chatId)
    .executeTakeFirst()
  if (!node) return

  const children = await db
    .selectFrom("message_nodes")
    .selectAll()
    .where("parent_id", "=", node.id)
    .execute()
  const timestamp = now()

  if (mode === "reparent") {
    if (children.length !== 1)
      throw new Error(
        children.length === 0
          ? "Reparent requires exactly one child; use subtree delete for a leaf"
          : "Reparent is only available when the node has exactly one child"
      )
    const child = children[0]!
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable("message_nodes")
        .set({ parent_id: node.parent_id, updated_at: timestamp })
        .where("id", "=", child.id)
        .execute()
      if (node.parent_id) {
        const parent = await trx
          .selectFrom("message_nodes")
          .select(["selected_child_id"])
          .where("id", "=", node.parent_id)
          .executeTakeFirst()
        if (!parent || parent.selected_child_id === node.id)
          await trx
            .updateTable("message_nodes")
            .set({ selected_child_id: child.id, updated_at: timestamp })
            .where("id", "=", node.parent_id)
            .execute()
      } else {
        const chat = await trx
          .selectFrom("chats")
          .select("selected_root_node_id")
          .where("id", "=", node.chat_id)
          .executeTakeFirst()
        if (!chat || chat.selected_root_node_id === node.id)
          await trx
            .updateTable("chats")
            .set({ selected_root_node_id: child.id, updated_at: timestamp })
            .where("id", "=", node.chat_id)
            .execute()
      }
      await trx.deleteFrom("message_nodes").where("id", "=", node.id).execute()
    })
    return
  }

  // Subtree delete (CASCADE removes descendants via FK).
  await deleteSingleNodeWithSelectionRepair(node)
}

/** Delete one node and rewire parent/root selection when it was the selected child. */
async function deleteSingleNodeWithSelectionRepair(
  node: Pick<NodeRow, "id" | "chat_id" | "parent_id">
) {
  const timestamp = now()
  await db.transaction().execute(async (trx) => {
    if (node.parent_id) {
      const parent = await trx
        .selectFrom("message_nodes")
        .select(["selected_child_id"])
        .where("id", "=", node.parent_id)
        .executeTakeFirst()
      if (parent?.selected_child_id === node.id) {
        const siblings = await trx
          .selectFrom("message_nodes")
          .select("id")
          .where("parent_id", "=", node.parent_id)
          .where("id", "!=", node.id)
          .orderBy("created_at")
          .execute()
        await trx
          .updateTable("message_nodes")
          .set({
            selected_child_id: siblings.at(-1)?.id ?? null,
            updated_at: timestamp,
          })
          .where("id", "=", node.parent_id)
          .execute()
      }
    } else {
      const chat = await trx
        .selectFrom("chats")
        .select("selected_root_node_id")
        .where("id", "=", node.chat_id)
        .executeTakeFirst()
      if (chat?.selected_root_node_id === node.id) {
        const siblings = await trx
          .selectFrom("message_nodes")
          .select("id")
          .where("chat_id", "=", node.chat_id)
          .where("parent_id", "is", null)
          .where("id", "!=", node.id)
          .orderBy("created_at")
          .execute()
        await trx
          .updateTable("chats")
          .set({
            selected_root_node_id: siblings.at(-1)?.id ?? null,
            updated_at: timestamp,
          })
          .where("id", "=", node.chat_id)
          .execute()
      }
    }
    await trx.deleteFrom("message_nodes").where("id", "=", node.id).execute()
  })
}

type ProviderProfileInput = {
  name: string
  kind: "openai" | "anthropic" | "openai-compatible"
  baseUrl?: string
  apiKey?: string
  apiKeyEnv?: string
  models: Array<{
    id: string
    label?: string
    enabled: boolean
    source: "catalog" | "custom"
  }>
}

export async function createProvider(
  userId: string,
  profile: ProviderProfileInput
) {
  const timestamp = now()
  const row = {
    id: id(),
    user_id: userId,
    name: profile.name,
    kind: profile.kind,
    base_url: profile.baseUrl || null,
    api_key: profile.apiKey || null,
    api_key_env: profile.apiKeyEnv || null,
    models_json: providerModelsToJson(parseProviderModels(profile.models)),
    created_at: timestamp,
    updated_at: timestamp,
  }
  await db.insertInto("provider_profiles").values(row).execute()
  return { id: row.id }
}

/** First-run finish: optional provider + title model, then mark setup complete. */
export async function finishSetup(
  userId: string,
  input: {
    provider?: ProviderProfileInput & { id?: string }
    titleModel?: string
  } | null
) {
  if (input?.provider) {
    const { id, ...profile } = input.provider
    const providerId = id
      ? (await updateProvider(userId, id, profile), id)
      : (await createProvider(userId, profile)).id
    if (input.titleModel) {
      await setInstanceTitleModel({
        providerId,
        model: input.titleModel,
      })
    }
  }
  await completeOnboarding()
  return { ok: true as const }
}

export async function updateProvider(
  userId: string,
  providerId: string,
  profile: ProviderProfileInput
) {
  const existing = await db
    .selectFrom("provider_profiles")
    .select("id")
    .where("id", "=", providerId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!existing) throw new Error("Provider not found")
  await db
    .updateTable("provider_profiles")
    .set({
      name: profile.name,
      kind: profile.kind,
      base_url: profile.baseUrl || null,
      ...(profile.apiKey !== undefined
        ? { api_key: profile.apiKey || null }
        : {}),
      api_key_env: profile.apiKeyEnv || null,
      models_json: providerModelsToJson(parseProviderModels(profile.models)),
      updated_at: now(),
    })
    .where("id", "=", providerId)
    .where("user_id", "=", userId)
    .execute()
  await clearTitleModelIfUnavailable()
}

export async function deleteProvider(userId: string, providerId: string) {
  await db
    .deleteFrom("provider_profiles")
    .where("id", "=", providerId)
    .where("user_id", "=", userId)
    .execute()
  await clearTitleModelIfUnavailable()
}

function themeRowToRecord(row: ThemeRow): ThemeRecord {
  return {
    id: row.id,
    name: row.name,
    document: parseAppearance(
      row.document_json ? JSON.parse(row.document_json) : {}
    ),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function listThemes() {
  const rows = await db
    .selectFrom("themes")
    .selectAll()
    .orderBy("name")
    .execute()
  return rows.map(themeRowToRecord)
}

export async function getTheme(themeId: string) {
  const row = await db
    .selectFrom("themes")
    .selectAll()
    .where("id", "=", themeId)
    .executeTakeFirst()
  if (!row) throw new Error("Theme not found")
  return themeRowToRecord(row)
}

export async function createTheme(input: {
  name: string
  document?: Appearance
}) {
  const timestamp = now()
  const document = parseAppearance(input.document ?? {})
  const row = {
    id: id(),
    name: input.name.trim() || "Untitled theme",
    document_json: appearanceToJson(document, false),
    created_at: timestamp,
    updated_at: timestamp,
  }
  await db.insertInto("themes").values(row).execute()
  return themeRowToRecord(row)
}

export async function updateTheme(
  themeId: string,
  input: { name?: string; document?: Appearance }
) {
  const existing = await db
    .selectFrom("themes")
    .selectAll()
    .where("id", "=", themeId)
    .executeTakeFirst()
  if (!existing) throw new Error("Theme not found")
  const patch: {
    name?: string
    document_json?: string
    updated_at: string
  } = { updated_at: now() }
  if (input.name !== undefined) patch.name = input.name.trim() || existing.name
  if (input.document !== undefined) {
    patch.document_json = appearanceToJson(
      parseAppearance(input.document),
      false
    )
  }
  await db.updateTable("themes").set(patch).where("id", "=", themeId).execute()
  return getTheme(themeId)
}

export async function duplicateTheme(themeId: string, name?: string) {
  const existing = await getTheme(themeId)
  return createTheme({
    name: name?.trim() || `${existing.name} copy`,
    document: existing.document,
  })
}

export async function deleteTheme(themeId: string) {
  const instance = await db
    .selectFrom("instance")
    .select(["light_theme_id", "dark_theme_id"])
    .where("id", "=", 1)
    .executeTakeFirstOrThrow()
  if (
    instance.light_theme_id === themeId ||
    instance.dark_theme_id === themeId
  ) {
    throw new Error(
      "Cannot delete a theme assigned to light or dark. Choose another theme for that slot first."
    )
  }
  const count = await db
    .selectFrom("themes")
    .select(sql<number>`count(*)`.as("n"))
    .executeTakeFirst()
  if (Number(count?.n ?? 0) <= 1) {
    throw new Error("Cannot delete the last theme.")
  }
  const existing = await db
    .selectFrom("themes")
    .select("id")
    .where("id", "=", themeId)
    .executeTakeFirst()
  if (!existing) throw new Error("Theme not found")
  await db.deleteFrom("themes").where("id", "=", themeId).execute()
}

export async function setThemeSlots(input: {
  lightThemeId: string
  darkThemeId: string
}) {
  const light = await db
    .selectFrom("themes")
    .select("id")
    .where("id", "=", input.lightThemeId)
    .executeTakeFirst()
  const dark = await db
    .selectFrom("themes")
    .select("id")
    .where("id", "=", input.darkThemeId)
    .executeTakeFirst()
  if (!light || !dark) throw new Error("Theme not found")
  await db
    .updateTable("instance")
    .set({
      light_theme_id: input.lightThemeId,
      dark_theme_id: input.darkThemeId,
    })
    .where("id", "=", 1)
    .execute()
  return {
    lightThemeId: input.lightThemeId,
    darkThemeId: input.darkThemeId,
  }
}

function stackRowToSummary(row: PromptStackRow) {
  return {
    id: row.id,
    name: row.name,
    stack: readStackJson(row.stack_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function listPromptStacks() {
  const rows = await db
    .selectFrom("prompt_stacks")
    .selectAll()
    .orderBy("name")
    .execute()
  return rows.map(stackRowToSummary)
}

export async function getPromptStack(stackId: string) {
  const row = await db
    .selectFrom("prompt_stacks")
    .selectAll()
    .where("id", "=", stackId)
    .executeTakeFirst()
  if (!row) throw new Error("Prompt stack not found")
  return stackRowToSummary(row)
}

export async function createPromptStack(input: {
  name: string
  stack?: PromptStackDocument
}) {
  const timestamp = now()
  const stack = input.stack
    ? requirePromptStack(input.stack)
    : defaultPromptStack()
  const row = {
    id: id(),
    name: input.name.trim() || "Untitled stack",
    stack_json: promptStackToJson(stack),
    created_at: timestamp,
    updated_at: timestamp,
  }
  await db.insertInto("prompt_stacks").values(row).execute()
  return stackRowToSummary(row)
}

export async function updatePromptStack(
  stackId: string,
  input: { name?: string; stack?: PromptStackDocument }
) {
  const existing = await db
    .selectFrom("prompt_stacks")
    .selectAll()
    .where("id", "=", stackId)
    .executeTakeFirst()
  if (!existing) throw new Error("Prompt stack not found")
  const patch: {
    name?: string
    stack_json?: string
    updated_at: string
  } = { updated_at: now() }
  if (input.name !== undefined) patch.name = input.name.trim() || existing.name
  if (input.stack !== undefined) {
    patch.stack_json = promptStackToJson(requirePromptStack(input.stack))
  }
  await db
    .updateTable("prompt_stacks")
    .set(patch)
    .where("id", "=", stackId)
    .execute()
  return getPromptStack(stackId)
}

export async function duplicatePromptStack(stackId: string, name?: string) {
  const existing = await getPromptStack(stackId)
  return createPromptStack({
    name: name?.trim() || `${existing.name} copy`,
    stack: existing.stack,
  })
}

export async function deletePromptStack(stackId: string) {
  const instance = await db
    .selectFrom("instance")
    .select("default_prompt_stack_id")
    .where("id", "=", 1)
    .executeTakeFirstOrThrow()
  if (instance.default_prompt_stack_id === stackId) {
    throw new Error(
      "Cannot delete the instance default stack. Choose another default first."
    )
  }
  const existing = await db
    .selectFrom("prompt_stacks")
    .select("id")
    .where("id", "=", stackId)
    .executeTakeFirst()
  if (!existing) throw new Error("Prompt stack not found")
  await db
    .updateTable("chats")
    .set({ prompt_stack_id: null })
    .where("prompt_stack_id", "=", stackId)
    .execute()
  await db.deleteFrom("prompt_stacks").where("id", "=", stackId).execute()
}

export async function setInstanceDefaultPromptStack(stackId: string) {
  const existing = await db
    .selectFrom("prompt_stacks")
    .select("id")
    .where("id", "=", stackId)
    .executeTakeFirst()
  if (!existing) throw new Error("Prompt stack not found")
  await db
    .updateTable("instance")
    .set({ default_prompt_stack_id: stackId })
    .where("id", "=", 1)
    .execute()
  return { ok: true as const, defaultPromptStackId: stackId }
}

export async function setChatPromptStack(
  userId: string,
  chatId: string,
  stackId: string | null
) {
  await assertChatOwner(chatId, userId)
  if (stackId) {
    const existing = await db
      .selectFrom("prompt_stacks")
      .select("id")
      .where("id", "=", stackId)
      .executeTakeFirst()
    if (!existing) throw new Error("Prompt stack not found")
  }
  await db
    .updateTable("chats")
    .set({ prompt_stack_id: stackId, updated_at: now() })
    .where("id", "=", chatId)
    .where("user_id", "=", userId)
    .execute()
  return { ok: true as const }
}

async function loadStacksById() {
  const rows = await db.selectFrom("prompt_stacks").selectAll().execute()
  const map = new Map<string, PromptStackDocument>()
  for (const row of rows) {
    map.set(row.id, readStackJson(row.stack_json))
  }
  return map
}

export async function resolveStackForChat(chat: {
  prompt_stack_id: string | null
}) {
  const instance = await db
    .selectFrom("instance")
    .select("default_prompt_stack_id")
    .where("id", "=", 1)
    .executeTakeFirstOrThrow()
  const stacksById = await loadStacksById()
  return resolvePromptStack({
    chatStackId: chat.prompt_stack_id,
    defaultStackId: instance.default_prompt_stack_id,
    stacksById,
  })
}

export async function getInstanceSettings() {
  const row = await db
    .selectFrom("instance")
    .select(["default_prompt_stack_id", "light_theme_id", "dark_theme_id"])
    .where("id", "=", 1)
    .executeTakeFirstOrThrow()
  const stacks = await listPromptStacks()
  const themes = await listThemes()
  return {
    defaultPromptStackId: row.default_prompt_stack_id,
    promptStacks: stacks,
    themes,
    lightThemeId: row.light_theme_id || PAPER_THEME_ID,
    darkThemeId: row.dark_theme_id || INK_THEME_ID,
    titleModelConfig: await getTitleModelConfig(),
  }
}

export async function restoreBackup(
  userId: string,
  raw: unknown,
  files: ReadonlyMap<string, Uint8Array> = new Map()
) {
  const backup = parseBackup(raw)
  const chatIds = new Set(backup.chats.map((chat) => chat.id))
  for (const node of backup.nodes) {
    if (!chatIds.has(node.chat_id))
      throw new Error(
        `Backup node ${node.id} references unknown chat ${node.chat_id}`
      )
  }
  const orderedNodes = orderNodesForInsert(backup.nodes)

  await db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom("chats")
      .select("id")
      .where("user_id", "=", userId)
      .executeTakeFirst()
    if (existing)
      throw new Error("Restore is only available on an empty owner instance")

    if (backup.promptStacks?.length) {
      for (const stack of backup.promptStacks) {
        const stackJson = promptStackToJson(readStackJson(stack.stack_json))
        await trx
          .insertInto("prompt_stacks")
          .values({
            id: stack.id,
            name: stack.name,
            stack_json: stackJson,
            created_at: stack.created_at,
            updated_at: stack.updated_at,
          })
          .onConflict((oc) =>
            oc.column("id").doUpdateSet({
              name: stack.name,
              stack_json: stackJson,
              updated_at: stack.updated_at,
            })
          )
          .execute()
      }
    }

    for (const chat of backup.chats) {
      await trx
        .insertInto("chats")
        .values({
          id: chat.id,
          user_id: userId,
          title: chat.title,
          selected_root_node_id: chat.selected_root_node_id,
          model_config_json: chat.model_config_json,
          prompt_stack_id: chat.prompt_stack_id ?? null,
          created_at: chat.created_at,
          updated_at: chat.updated_at,
        })
        .execute()
    }

    const nodeIds = new Set(orderedNodes.map((node) => node.id))
    const restoredAttachmentIds = new Set<string>()
    for (const attachment of backup.attachments) {
      const data = files.get(attachment.file)
      if (!data)
        throw new Error("This backup includes files; restore the .zip archive")
      if (data.byteLength !== attachment.byte_size)
        throw new Error(`Backup attachment ${attachment.id} has the wrong size`)
      const mediaType = validateImageSignature(data, attachment.media_type)
      const sha256 = createHash("sha256").update(data).digest("hex")
      if (sha256 !== attachment.sha256)
        throw new Error(`Backup attachment ${attachment.id} is corrupt`)
      const stored = await attachmentStorage.put({
        sha256: attachment.sha256,
        data,
      })
      await trx
        .insertInto("attachments")
        .values({
          id: attachment.id,
          user_id: userId,
          filename: attachment.filename,
          media_type: mediaType,
          byte_size: attachment.byte_size,
          sha256: attachment.sha256,
          storage_backend: attachmentStorage.kind,
          storage_key: stored.storageKey,
          data: stored.data,
          claimed_at: attachment.claimed_at,
          created_at: attachment.created_at,
        })
        .execute()
      restoredAttachmentIds.add(attachment.id)
    }

    for (const node of orderedNodes) {
      await trx
        .insertInto("message_nodes")
        .values({
          id: node.id,
          chat_id: node.chat_id,
          parent_id: node.parent_id,
          selected_child_id: node.selected_child_id,
          role: node.role,
          parts_json: node.parts_json,
          search_text: node.search_text,
          metadata_json: node.metadata_json,
          excluded_from_context: toDbBool(node.excluded_from_context),
          status: node.status,
          created_at: node.created_at,
          updated_at: node.updated_at,
        })
        .execute()
    }
    for (const link of backup.messageAttachments) {
      if (!nodeIds.has(link.message_node_id))
        throw new Error(
          `Backup message attachment references unknown node ${link.message_node_id}`
        )
      if (!restoredAttachmentIds.has(link.attachment_id))
        throw new Error(
          `Backup message attachment references unknown attachment ${link.attachment_id}`
        )
      await trx
        .insertInto("message_attachments")
        .values({
          message_node_id: link.message_node_id,
          attachment_id: link.attachment_id,
        })
        .execute()
    }
    for (const provider of backup.providerProfiles) {
      await trx
        .insertInto("provider_profiles")
        .values({
          id: provider.id,
          user_id: userId,
          name: provider.name,
          kind: provider.kind,
          base_url: provider.base_url ?? null,
          api_key: null,
          api_key_env: provider.api_key_env ?? null,
          models_json: provider.models_json,
          created_at: provider.created_at,
          updated_at: provider.updated_at,
        })
        .execute()
    }
    for (const profile of backup.mcpServerProfiles) {
      await trx
        .insertInto("mcp_server_profiles")
        .values({
          id: profile.id,
          user_id: userId,
          name: profile.name,
          namespace: profile.namespace,
          enabled:
            databaseKind === "sqlite"
              ? ((profile.enabled ? 1 : 0) as unknown as boolean)
              : profile.enabled,
          transport: profile.transport,
          protocol_mode: profile.protocol_mode,
          config_json: profile.config_json,
          catalog_json: profile.catalog_json,
          tool_allowlist_json: profile.tool_allowlist_json,
          created_at: profile.created_at,
          updated_at: profile.updated_at,
        })
        .execute()
    }
    if (backup.themes?.length) {
      for (const theme of backup.themes) {
        const documentJson = appearanceToJson(
          parseAppearance(theme.document),
          false
        )
        await trx
          .insertInto("themes")
          .values({
            id: theme.id,
            name: theme.name,
            document_json: documentJson,
            created_at: theme.created_at,
            updated_at: theme.updated_at,
          })
          .onConflict((oc) =>
            oc.column("id").doUpdateSet({
              name: theme.name,
              document_json: documentJson,
              updated_at: theme.updated_at,
            })
          )
          .execute()
      }
    }

    let lightThemeId = PAPER_THEME_ID
    let darkThemeId = INK_THEME_ID
    if (backup.instance?.lightThemeId && backup.instance?.darkThemeId) {
      lightThemeId = backup.instance.lightThemeId
      darkThemeId = backup.instance.darkThemeId
    }
    const defaultStackId =
      backup.instance?.default_prompt_stack_id ??
      (
        await trx
          .selectFrom("instance")
          .select("default_prompt_stack_id")
          .where("id", "=", 1)
          .executeTakeFirstOrThrow()
      ).default_prompt_stack_id

    if (
      backup.instance ||
      backup.themes?.length ||
      backup.promptStacks?.length
    ) {
      const titleModelJson =
        backup.instance && "titleModelConfig" in backup.instance
          ? backup.instance.titleModelConfig
            ? JSON.stringify({
                providerId: backup.instance.titleModelConfig.providerId,
                model: backup.instance.titleModelConfig.model,
              })
            : null
          : undefined
      await trx
        .updateTable("instance")
        .set({
          default_prompt_stack_id: defaultStackId,
          light_theme_id: lightThemeId,
          dark_theme_id: darkThemeId,
          ...(titleModelJson !== undefined
            ? { title_model_config_json: titleModelJson }
            : {}),
        })
        .where("id", "=", 1)
        .execute()
    }
  })
}

export async function createBackup(userId: string) {
  const chats = await db
    .selectFrom("chats")
    .selectAll()
    .where("user_id", "=", userId)
    .execute()
  const chatIds = chats.map((chat) => chat.id)
  const rawNodes =
    chatIds.length === 0
      ? []
      : await db
          .selectFrom("message_nodes")
          .selectAll()
          .where("chat_id", "in", chatIds)
          .execute()
  const nodes = rawNodes.map((node) => normalizeNodeRow(node))
  const providers = await db
    .selectFrom("provider_profiles")
    .select([
      "id",
      "user_id",
      "name",
      "kind",
      "base_url",
      "api_key_env",
      "models_json",
      "created_at",
      "updated_at",
    ])
    .where("user_id", "=", userId)
    .execute()
  const promptStacks = await db
    .selectFrom("prompt_stacks")
    .selectAll()
    .execute()
  const themes = await db.selectFrom("themes").selectAll().execute()
  const mcpRows = await db
    .selectFrom("mcp_server_profiles")
    .selectAll()
    .where("user_id", "=", userId)
    .execute()
  const mcpServerProfiles = mcpRows.map((row) =>
    mcpProfileForBackup(profileFromRow(row))
  )
  const attachmentRows = await db
    .selectFrom("attachments")
    .selectAll()
    .where("user_id", "=", userId)
    .execute()
  const attachments = attachmentRows.map((row) => ({
    id: row.id,
    filename: row.filename,
    media_type: row.media_type,
    byte_size: row.byte_size,
    sha256: row.sha256,
    claimed_at: row.claimed_at,
    created_at: row.created_at,
    file: attachmentArchivePath(row.id),
  }))
  const messageAttachments =
    chatIds.length === 0
      ? []
      : await db
          .selectFrom("message_attachments")
          .innerJoin(
            "message_nodes",
            "message_nodes.id",
            "message_attachments.message_node_id"
          )
          .select([
            "message_attachments.message_node_id",
            "message_attachments.attachment_id",
          ])
          .where("message_nodes.chat_id", "in", chatIds)
          .execute()
  const normalizedStacks = promptStacks.map((row) => ({
    ...row,
    stack_json: promptStackToJson(readStackJson(row.stack_json)),
  }))
  const normalizedThemes = themes.map((row) => ({
    id: row.id,
    name: row.name,
    document: parseAppearance(
      row.document_json ? JSON.parse(row.document_json) : {}
    ),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }))
  const instance = await db
    .selectFrom("instance")
    .select(["default_prompt_stack_id", "light_theme_id", "dark_theme_id"])
    .where("id", "=", 1)
    .executeTakeFirst()
  const titleModelConfig = await getTitleModelConfig()
  return {
    version: 1 as const,
    createdAt: new Date().toISOString(),
    instance: instance
      ? {
          default_prompt_stack_id: instance.default_prompt_stack_id,
          lightThemeId: instance.light_theme_id,
          darkThemeId: instance.dark_theme_id,
          titleModelConfig,
        }
      : undefined,
    promptStacks: normalizedStacks,
    themes: normalizedThemes,
    chats,
    nodes,
    attachments,
    messageAttachments,
    providerProfiles: providers,
    mcpServerProfiles,
  }
}

export async function createBackupArchive(userId: string) {
  const backup = await createBackup(userId)
  const files = new Map<string, Uint8Array>()
  if (backup.attachments.length) {
    const rows = await db
      .selectFrom("attachments")
      .selectAll()
      .where("user_id", "=", userId)
      .execute()
    const byId = new Map(rows.map((row) => [row.id, row]))
    for (const attachment of backup.attachments) {
      const row = byId.get(attachment.id)
      if (!row) throw new Error(`Attachment ${attachment.id} is missing`)
      files.set(attachment.file, await readAttachment(row))
    }
  }
  return packBackupArchive(backup, files)
}

export async function restoreBackupArchive(userId: string, bytes: Uint8Array) {
  const { backup, files } = unpackBackupArchive(bytes)
  await restoreBackup(userId, backup, files)
}
