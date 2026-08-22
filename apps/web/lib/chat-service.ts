import "server-only"
import { createHash } from "node:crypto"
import { sql, type Transaction } from "kysely"
import { db, fromDbBool, toDbBool } from "@/lib/db"
import { id, now, parseJson, subtreeNodeIds } from "@/lib/domain"
import {
  applyMessageEdits,
  isEmptyParts,
  partsHavePendingClientTools,
  searchTextFromParts,
  type MessageEditSegment,
} from "@/lib/agent/parts"
import { abortGenerations } from "@/lib/active-generations"
import {
  claimGenerationRecovery,
  insertGenerationRun,
  removeGenerationRun,
  restoreGenerationRunState,
} from "@/lib/generation-runs"
import { generationStreamStore } from "@/lib/generation-streams/default-port"
import { reduceGenerationPayload } from "@/lib/generation-streams/events"
import {
  FOLLOWABLE_RUN_STATES,
  revertRecoveryState,
  shouldReconcileGeneration,
  type GenerationRunState,
} from "@/lib/generation-streams/policy"
import type {
  DB,
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
import { orderNodesForInsert, parseBackup, type Backup } from "@/lib/backup"
import {
  isEnabledModelId,
  parseProviderModels,
  parseProviderModelsJson,
  providerModelsToJson,
} from "@/lib/provider-models"
import { mcpProfileForBackup, profileFromRow } from "@/lib/mcp"
import {
  appearanceToJson,
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
import { validateAttachmentSignature } from "@/lib/file-signatures"
import {
  ensureUserSettings,
  getUserSettings,
  setUserThemeSlots,
} from "@/lib/user-settings"

function normalizeNodeRow(node: NodeRow): NodeRow {
  return {
    ...node,
    excluded_from_context: fromDbBool(node.excluded_from_context),
  }
}

async function cancelGenerationRuns(nodeIds: Iterable<string>) {
  const ids = [...nodeIds]
  if (!ids.length) return
  const runs = await db
    .selectFrom("generation_runs")
    .select("id")
    .where("node_id", "in", ids)
    .execute()
  await Promise.all(
    runs.map((run) =>
      generationStreamStore.requestCancel(run.id).catch((error) => {
        // Database deletion is authoritative and cascades the run, fencing
        // later terminal writes. Stream-store cancellation is only a prompt
        // best-effort signal to a still-running producer.
        console.warn("[nibchat/generation-cancel]", run.id, error)
      })
    )
  )
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
  if (selected) await reconcileChatGenerationRuns(selected.id)
  const nodes = selected
    ? await db
        .selectFrom("message_nodes")
        .selectAll()
        .where("chat_id", "=", selected.id)
        .orderBy("created_at")
        .execute()
    : []
  const activeGenerations = selected
    ? await db
        .selectFrom("generation_runs")
        .innerJoin(
          "message_nodes",
          "message_nodes.id",
          "generation_runs.node_id"
        )
        .select([
          "generation_runs.id as generationId",
          "generation_runs.node_id as nodeId",
          "generation_runs.chat_id as chatId",
          "generation_runs.started_at as startedAt",
          "message_nodes.parent_id as parentNodeId",
        ])
        .where("generation_runs.chat_id", "=", selected.id)
        .where("generation_runs.state", "in", [...FOLLOWABLE_RUN_STATES])
        .execute()
    : []
  return {
    chats,
    chat: selected ?? null,
    nodes: nodes.map((node) => normalizeNodeRow(node)),
    activeGenerations,
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
      .where("user_id", "=", userId)
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
  await cancelGenerationRuns(nodeIds.map((row) => row.id))
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
  /** Required when inserting a streaming assistant. */
  generationId?: string
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
    if (input.generationId)
      await insertGenerationRun(trx, {
        id: input.generationId,
        nodeId: node.id,
        chatId: node.chat_id,
      })
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
  generationId?: string
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
    if (input.generationId)
      await insertGenerationRun(trx, {
        id: input.generationId,
        nodeId: assistant.id,
        chatId: assistant.chat_id,
      })
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
  edits: MessageEditSegment[],
  options: { attachSelection?: boolean } = {}
) {
  const original = await assertNodeOwner(nodeId, userId)
  const originalParts = nodeParts(original)
  if (
    original.status === "streaming" ||
    original.status === "awaiting_input" ||
    partsHavePendingClientTools(originalParts)
  ) {
    throw new Error("Cannot edit a message that is still in progress.")
  }
  const parts = applyMessageEdits(originalParts, edits)
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
    part.type === "attachment" &&
    (part.content.kind === "binary" || part.content.kind === "document")
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
  generationId?: string,
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
    generationId,
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
  generationId?: string,
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
    generationId,
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
  /** Fences terminal writes to the generation that still owns this node. */
  generationId?: string
  outcome: StreamFinalizeOutcome
  /** Full ordered parts for the completed multi-stage turn. */
  parts: Parts
  usage?: unknown
  finishReason?: string
  error?: string
  config?: ModelConfig
  previousMetadata?: Record<string, unknown>
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

/**
 * Single write path for stream terminal outcomes.
 * Idempotent: only mutates rows still in `fromStatuses` (default streaming).
 * Returns "missing" if cascade-deleted, "superseded" if already finalized.
 */
export async function finalizeStreamingAssistant(
  input: StreamFinalizeInput
): Promise<StreamFinalizeResult> {
  const fromStatuses = ["streaming"] as MessageStatus[]
  if (input.generationId) {
    const run = await db
      .selectFrom("generation_runs")
      .select(["id", "node_id"])
      .where("id", "=", input.generationId)
      .executeTakeFirst()
    if (!run || run.node_id !== input.nodeId) return "superseded"
  }
  const finishRun = async (result: StreamFinalizeResult) => {
    if (input.generationId) await removeGenerationRun(db, input.generationId)
    return result
  }
  const row = await db
    .selectFrom("message_nodes")
    .select(["id", "chat_id", "status", "metadata_json"])
    .where("id", "=", input.nodeId)
    .executeTakeFirst()
  if (!row) return finishRun("missing")
  if (!(fromStatuses as string[]).includes(row.status))
    return finishRun("superseded")

  const parts = input.parts
  const previous = {
    ...parseJson<Record<string, unknown>>(row.metadata_json, {}),
    ...(input.previousMetadata ?? {}),
  }
  const config = input.config

  if (input.outcome === "aborted") {
    if (isEmptyParts(parts)) {
      return finishRun(await deleteStreamingShell(input.nodeId))
    }
    const updated = await updateStreamingNode(
      input.nodeId,
      parts,
      "stopped",
      fromStatuses
    )
    return finishRun(updated ? "stopped" : "superseded")
  }

  if (input.outcome === "error") {
    const updated = await updateStreamingNode(
      input.nodeId,
      parts,
      "error",
      fromStatuses
    )
    if (!updated) return finishRun("superseded")
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
    return finishRun("error")
  }

  if (input.outcome === "awaiting_input") {
    const updated = await updateStreamingNode(
      input.nodeId,
      parts,
      "awaiting_input",
      fromStatuses
    )
    if (!updated) return finishRun("superseded")
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
    return finishRun("awaiting_input")
  }

  // complete
  const updated = await updateStreamingNode(
    input.nodeId,
    parts,
    "complete",
    fromStatuses
  )
  if (!updated) return finishRun("superseded")
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
  return finishRun("complete")
}

/** Lazy reconciliation: never treat an adapter outage as a lost producer. */
async function reconcileChatGenerationRuns(chatId: string) {
  const runs = await db
    .selectFrom("generation_runs")
    .selectAll()
    .where("chat_id", "=", chatId)
    .execute()
  for (const run of runs) {
    let snapshot
    try {
      snapshot = await generationStreamStore.inspect(run.id)
    } catch (error) {
      console.warn("[nibchat/generation-reconcile] store unavailable", error)
      continue
    }
    if (
      !shouldReconcileGeneration(
        {
          state: run.state as GenerationRunState,
          startedAt: run.started_at,
        },
        snapshot
      )
    )
      continue
    if (!(await claimGenerationRecovery(run.id))) continue
    let parts: Parts = []
    try {
      for (const event of await generationStreamStore.replay(run.id))
        parts = reduceGenerationPayload(parts, event.payload)
    } catch (error) {
      console.warn("[nibchat/generation-reconcile] replay unavailable", error)
      await restoreGenerationRunState(
        run.id,
        revertRecoveryState(run.state as GenerationRunState)
      )
      continue
    }
    await finalizeStreamingAssistant({
      nodeId: run.node_id,
      generationId: run.id,
      outcome: run.state === "cancel_requested" ? "aborted" : "error",
      parts,
      error:
        run.state === "cancel_requested"
          ? undefined
          : "Generation interrupted before completion.",
    })
    await generationStreamStore.discard(run.id).catch(() => {})
  }
}

/**
 * Apply tool outputs on an awaiting_input assistant and mark as streaming for resume.
 * CAS: only transitions from awaiting_input → streaming.
 */
export async function beginResumeAssistant(
  nodeId: string,
  parts: Parts,
  generationId?: string
): Promise<"streaming" | "missing" | "superseded"> {
  const row = await db
    .selectFrom("message_nodes")
    .select(["id", "status"])
    .where("id", "=", nodeId)
    .executeTakeFirst()
  if (!row) return "missing"
  if (row.status !== "awaiting_input") return "superseded"
  return db.transaction().execute(async (trx) => {
    const result = await trx
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
    if (Number(result.numUpdatedRows ?? 0) === 0) return "superseded"
    const current = await trx
      .selectFrom("message_nodes")
      .select("chat_id")
      .where("id", "=", nodeId)
      .executeTakeFirstOrThrow()
    if (generationId)
      await insertGenerationRun(trx, {
        id: generationId,
        nodeId,
        chatId: current.chat_id,
      })
    return "streaming"
  })
}

/**
 * Undo a failed resume claim: restore original parts and awaiting_input only
 * while the node is still streaming (setup failed before/around stream start).
 */
export async function restoreAwaitingInput(
  nodeId: string,
  originalParts: Parts,
  generationId?: string
): Promise<"awaiting_input" | "missing" | "superseded"> {
  const row = await db
    .selectFrom("message_nodes")
    .select(["id", "status"])
    .where("id", "=", nodeId)
    .executeTakeFirst()
  if (!row) return "missing"
  if (row.status !== "streaming") return "superseded"
  return db.transaction().execute(async (trx) => {
    const result = await trx
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
    if (Number(result.numUpdatedRows ?? 0) === 0) return "superseded"
    if (generationId) await removeGenerationRun(trx, generationId)
    return "awaiting_input"
  })
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

export async function deleteNode(
  userId: string,
  nodeId: string,
  mode: "subtree" | "reparent"
) {
  const node = await assertNodeOwner(nodeId, userId)

  if (mode === "reparent") {
    abortGenerations([node.id])
    await cancelGenerationRuns([node.id])
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
  await cancelGenerationRuns(subtreeNodeIds(chatNodes, node.id))
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
    pdfInput: "native" | "extracted"
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
    .execute()
  await clearTitleModelIfUnavailable()
}

export async function deleteProvider(userId: string, providerId: string) {
  await db
    .deleteFrom("provider_profiles")
    .where("id", "=", providerId)
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

export async function listThemes(userId: string) {
  const rows = await db
    .selectFrom("themes")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("name")
    .execute()
  return rows.map(themeRowToRecord)
}

export async function getTheme(userId: string, themeId: string) {
  const row = await db
    .selectFrom("themes")
    .selectAll()
    .where("id", "=", themeId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!row) throw new Error("Theme not found")
  return themeRowToRecord(row)
}

export async function createTheme(input: {
  userId: string
  name: string
  document?: Appearance
}) {
  const timestamp = now()
  const document = parseAppearance(input.document ?? {})
  const row = {
    id: id(),
    user_id: input.userId,
    name: input.name.trim() || "Untitled theme",
    document_json: appearanceToJson(document, false),
    created_at: timestamp,
    updated_at: timestamp,
  }
  await db.insertInto("themes").values(row).execute()
  return themeRowToRecord(row)
}

export async function updateTheme(
  userId: string,
  themeId: string,
  input: { name?: string; document?: Appearance }
) {
  const existing = await db
    .selectFrom("themes")
    .selectAll()
    .where("id", "=", themeId)
    .where("user_id", "=", userId)
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
  return getTheme(userId, themeId)
}

export async function duplicateTheme(
  userId: string,
  themeId: string,
  name?: string
) {
  const existing = await getTheme(userId, themeId)
  return createTheme({
    userId,
    name: name?.trim() || `${existing.name} copy`,
    document: existing.document,
  })
}

export async function deleteTheme(userId: string, themeId: string) {
  const prefs = await ensureUserSettings(userId)
  if (prefs.light_theme_id === themeId || prefs.dark_theme_id === themeId) {
    throw new Error(
      "Cannot delete a theme assigned to light or dark. Choose another theme for that slot first."
    )
  }
  const count = await db
    .selectFrom("themes")
    .select(sql<number>`count(*)`.as("n"))
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (Number(count?.n ?? 0) <= 1) {
    throw new Error("Cannot delete the last theme.")
  }
  const existing = await db
    .selectFrom("themes")
    .select("id")
    .where("id", "=", themeId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!existing) throw new Error("Theme not found")
  await db
    .deleteFrom("themes")
    .where("id", "=", themeId)
    .where("user_id", "=", userId)
    .execute()
}

export async function setThemeSlots(input: {
  userId: string
  lightThemeId: string
  darkThemeId: string
}) {
  return setUserThemeSlots(input.userId, input.lightThemeId, input.darkThemeId)
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

export async function listPromptStacks(userId: string) {
  const rows = await db
    .selectFrom("prompt_stacks")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("name")
    .execute()
  return rows.map(stackRowToSummary)
}

export async function getPromptStack(userId: string, stackId: string) {
  const row = await db
    .selectFrom("prompt_stacks")
    .selectAll()
    .where("id", "=", stackId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!row) throw new Error("Prompt stack not found")
  return stackRowToSummary(row)
}

export async function createPromptStack(input: {
  userId: string
  name: string
  stack?: PromptStackDocument
}) {
  const timestamp = now()
  const stack = input.stack
    ? requirePromptStack(input.stack)
    : defaultPromptStack()
  const row = {
    id: id(),
    user_id: input.userId,
    name: input.name.trim() || "Untitled stack",
    stack_json: promptStackToJson(stack),
    created_at: timestamp,
    updated_at: timestamp,
  }
  await db.insertInto("prompt_stacks").values(row).execute()
  return stackRowToSummary(row)
}

export async function updatePromptStack(
  userId: string,
  stackId: string,
  input: { name?: string; stack?: PromptStackDocument }
) {
  const existing = await db
    .selectFrom("prompt_stacks")
    .selectAll()
    .where("id", "=", stackId)
    .where("user_id", "=", userId)
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
  return getPromptStack(userId, stackId)
}

export async function duplicatePromptStack(
  userId: string,
  stackId: string,
  name?: string
) {
  const existing = await getPromptStack(userId, stackId)
  return createPromptStack({
    userId,
    name: name?.trim() || `${existing.name} copy`,
    stack: existing.stack,
  })
}

export async function deletePromptStack(userId: string, stackId: string) {
  const prefs = await ensureUserSettings(userId)
  if (prefs.default_prompt_stack_id === stackId) {
    throw new Error(
      "Cannot delete the default stack. Choose another default first."
    )
  }
  const existing = await db
    .selectFrom("prompt_stacks")
    .select("id")
    .where("id", "=", stackId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!existing) throw new Error("Prompt stack not found")
  await db
    .updateTable("chats")
    .set({ prompt_stack_id: null })
    .where("prompt_stack_id", "=", stackId)
    .where("user_id", "=", userId)
    .execute()
  await db
    .deleteFrom("prompt_stacks")
    .where("id", "=", stackId)
    .where("user_id", "=", userId)
    .execute()
}

export async function setInstanceDefaultPromptStack(
  userId: string,
  stackId: string
) {
  const existing = await db
    .selectFrom("prompt_stacks")
    .select("id")
    .where("id", "=", stackId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!existing) throw new Error("Prompt stack not found")
  await db
    .updateTable("user_preferences")
    .set({ default_prompt_stack_id: stackId, updated_at: now() })
    .where("user_id", "=", userId)
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
      .where("user_id", "=", userId)
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

async function loadStacksById(userId: string) {
  const query = db
    .selectFrom("prompt_stacks")
    .selectAll()
    .where("user_id", "=", userId)
  const rows = await query.execute()
  const map = new Map<string, PromptStackDocument>()
  for (const row of rows) {
    map.set(row.id, readStackJson(row.stack_json))
  }
  return map
}

export async function resolveStackForChat(
  chat: {
    prompt_stack_id: string | null
  },
  userId: string
) {
  const prefs = await ensureUserSettings(userId)
  const stacksById = await loadStacksById(userId)
  return resolvePromptStack({
    chatStackId: chat.prompt_stack_id,
    defaultStackId: prefs.default_prompt_stack_id,
    stacksById,
  })
}

export async function getInstanceSettings(userId: string) {
  const prefs = await getUserSettings(userId)
  return {
    defaultPromptStackId: prefs.default_prompt_stack_id,
    promptStacks: prefs.promptStacks,
    themes: prefs.themes,
    lightThemeId: prefs.light_theme_id,
    darkThemeId: prefs.dark_theme_id,
    themeMode: prefs.theme_mode,
    titleModelConfig: await getTitleModelConfig(),
  }
}

export async function restoreBackup(
  userId: string,
  raw: unknown,
  files: ReadonlyMap<string, Uint8Array> = new Map()
) {
  const backup = parseBackup(raw)
  validateMultiUserBackup(backup, files)
  await restoreMultiUserBackup(userId, backup, files)
}

async function restoreOwnerBackup(
  trx: Transaction<DB>,
  userId: string,
  backup: Backup,
  files: ReadonlyMap<string, Uint8Array>
) {
  const nodeIds = new Set(backup.nodes.map((node) => node.id))

  if (backup.promptStacks.length) {
    for (const stack of backup.promptStacks) {
      const stackJson = promptStackToJson(readStackJson(stack.stack_json))
      await trx
        .insertInto("prompt_stacks")
        .values({
          id: stack.id,
          user_id: stack.user_id,
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

  const restoredAttachmentIds = new Set<string>()
  for (const attachment of backup.attachments) {
    const data = files.get(attachment.file)
    if (!data)
      throw new Error("This backup includes files; restore the .zip archive")
    if (data.byteLength !== attachment.byte_size)
      throw new Error(`Backup attachment ${attachment.id} has the wrong size`)
    const mediaType = validateAttachmentSignature(data, attachment.media_type)
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

  await insertRestoredMessageNodes(trx, backup.nodes)
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
        enabled: toDbBool(profile.enabled),
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
          user_id: theme.user_id,
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

  if (backup.instance) {
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
        ...(titleModelJson !== undefined
          ? { title_model_config_json: titleModelJson }
          : {}),
      })
      .where("id", "=", 1)
      .execute()
  }
}

function validateMultiUserBackup(
  backup: Backup,
  files: ReadonlyMap<string, Uint8Array>
) {
  const users = new Set(backup.users.map((user) => user.id))
  if (users.size !== backup.users.length || users.size === 0)
    throw new Error("Backup contains invalid users")
  const owners = backup.users.filter((user) => user.role === "admin")
  if (owners.length !== 1)
    throw new Error("Backup must contain exactly one owner")

  const unique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length)
      throw new Error(`Backup contains duplicate ${label} ids`)
  }
  unique(
    backup.chats.map((chat) => chat.id),
    "chat"
  )
  unique(
    backup.nodes.map((node) => node.id),
    "node"
  )
  unique(
    backup.attachments.map((attachment) => attachment.id),
    "attachment"
  )
  unique(
    backup.themes.map((theme) => theme.id),
    "theme"
  )
  unique(
    backup.promptStacks.map((stack) => stack.id),
    "prompt stack"
  )

  for (const theme of backup.themes) {
    if (!users.has(theme.user_id))
      throw new Error(`Backup theme ${theme.id} references an unknown user`)
  }
  for (const stack of backup.promptStacks) {
    if (!users.has(stack.user_id))
      throw new Error(
        `Backup prompt stack ${stack.id} references an unknown user`
      )
  }

  for (const chat of backup.chats) {
    if (!users.has(chat.user_id))
      throw new Error(`Backup chat ${chat.id} references an unknown user`)
  }
  const chats = new Set(backup.chats.map((chat) => chat.id))
  const stacks = new Map(backup.promptStacks.map((stack) => [stack.id, stack]))
  for (const chat of backup.chats) {
    if (!chat.prompt_stack_id) continue
    const stack = stacks.get(chat.prompt_stack_id)
    if (!stack || stack.user_id !== chat.user_id)
      throw new Error(
        `Backup chat ${chat.id} references another user's prompt stack`
      )
  }
  for (const node of backup.nodes) {
    if (!chats.has(node.chat_id))
      throw new Error(`Backup node ${node.id} references an unknown chat`)
  }
  const nodes = new Set(backup.nodes.map((node) => node.id))
  const attachments = new Set(
    backup.attachments.map((attachment) => attachment.id)
  )
  for (const link of backup.messageAttachments) {
    if (
      !nodes.has(link.message_node_id) ||
      !attachments.has(link.attachment_id)
    )
      throw new Error("Backup contains an invalid attachment link")
  }
  for (const attachment of backup.attachments) {
    if (!users.has(attachment.user_id))
      throw new Error(
        `Backup attachment ${attachment.id} references an unknown user`
      )
    const data = files.get(attachment.file)
    if (!data) throw new Error(`Backup attachment ${attachment.id} is missing`)
    if (data.byteLength !== attachment.byte_size)
      throw new Error(`Backup attachment ${attachment.id} has the wrong size`)
    validateAttachmentSignature(data, attachment.media_type)
    const sha256 = createHash("sha256").update(data).digest("hex")
    if (sha256 !== attachment.sha256)
      throw new Error(`Backup attachment ${attachment.id} is corrupt`)
  }
  const themes = new Map(backup.themes.map((theme) => [theme.id, theme]))
  for (const prefs of backup.userPreferences) {
    if (!users.has(prefs.user_id))
      throw new Error("Backup preferences reference an unknown user")
    const light = themes.get(prefs.light_theme_id)
    const dark = themes.get(prefs.dark_theme_id)
    const stack = stacks.get(prefs.default_prompt_stack_id)
    if (
      !light ||
      !dark ||
      !stack ||
      light.user_id !== prefs.user_id ||
      dark.user_id !== prefs.user_id ||
      stack.user_id !== prefs.user_id
    )
      throw new Error("Backup preferences reference another user's settings")
  }
  const preferenceUsers = backup.userPreferences.map((prefs) => prefs.user_id)
  if (
    preferenceUsers.length !== users.size ||
    new Set(preferenceUsers).size !== preferenceUsers.length ||
    preferenceUsers.some((userId) => !users.has(userId))
  )
    throw new Error("Backup must contain one settings record for every user")
}

async function insertRestoredMessageNodes(
  trx: Transaction<DB>,
  nodes: Backup["nodes"]
) {
  for (const node of orderNodesForInsert(nodes)) {
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
}

async function restoreMultiUserBackup(
  ownerId: string,
  backup: ReturnType<typeof parseBackup>,
  files: ReadonlyMap<string, Uint8Array>
) {
  const sourceOwner =
    backup.users.find((user) => user.role === "admin") ?? backup.users[0]
  if (!sourceOwner) throw new Error("Backup does not contain an owner")
  const ownerChatIds = new Set(
    backup.chats
      .filter((chat) => chat.user_id === sourceOwner.id)
      .map((chat) => chat.id)
  )
  const ownerNodes = backup.nodes.filter((node) =>
    ownerChatIds.has(node.chat_id)
  )
  const ownerAttachments = backup.attachments.filter(
    (attachment) => attachment.user_id === sourceOwner.id
  )
  const ownerLinks = backup.messageAttachments.filter((link) =>
    ownerNodes.some((node) => node.id === link.message_node_id)
  )
  const ownerBackup: Backup = {
    version: 1,
    createdAt: backup.createdAt,
    instance: backup.instance,
    chats: backup.chats.filter((chat) => ownerChatIds.has(chat.id)),
    nodes: ownerNodes,
    attachments: ownerAttachments,
    messageAttachments: ownerLinks,
    providerProfiles: backup.providerProfiles,
    mcpServerProfiles: backup.mcpServerProfiles,
    promptStacks: backup.promptStacks
      .filter((stack) => stack.user_id === sourceOwner.id)
      .map((stack) => ({ ...stack, user_id: ownerId })),
    themes: backup.themes
      .filter((theme) => theme.user_id === sourceOwner.id)
      .map((theme) => ({ ...theme, user_id: ownerId })),
    users: [sourceOwner],
    userPreferences: [],
  }

  await db.transaction().execute(async (trx) => {
    const existingChats = await trx
      .selectFrom("chats")
      .select("id")
      .executeTakeFirst()
    const existingUsers = await trx.selectFrom("user").select("id").execute()
    if (existingChats || existingUsers.some((user) => user.id !== ownerId))
      throw new Error("Restore is only available on an empty instance")

    await restoreOwnerBackup(trx, ownerId, ownerBackup, files)

    const ownerPrefs = backup.userPreferences.find(
      (prefs) => prefs.user_id === sourceOwner.id
    )
    if (!ownerPrefs) throw new Error("Backup owner is missing preferences")
    await trx
      .insertInto("user_preferences")
      .values({
        ...ownerPrefs,
        user_id: ownerId,
      })
      .onConflict((oc) =>
        oc.column("user_id").doUpdateSet({
          light_theme_id: ownerPrefs.light_theme_id,
          dark_theme_id: ownerPrefs.dark_theme_id,
          default_prompt_stack_id: ownerPrefs.default_prompt_stack_id,
          theme_mode: ownerPrefs.theme_mode,
          updated_at: ownerPrefs.updated_at,
        })
      )
      .execute()

    for (const sourceUser of backup.users) {
      if (sourceUser.id === sourceOwner.id) continue
      await trx
        .insertInto("user")
        .values({
          id: sourceUser.id,
          name: sourceUser.name,
          email: sourceUser.email,
          emailVerified: toDbBool(Boolean(sourceUser.emailVerified)),
          image: null,
          createdAt: sourceUser.createdAt,
          updatedAt: sourceUser.updatedAt,
          role: "user",
          // Credentials are intentionally excluded from portable backups.
          // Restored users stay disabled until the owner sets a password.
          banned: toDbBool(true),
          banReason: "Restored account requires a password reset.",
          banExpires: null,
        })
        .execute()
      const userChats = backup.chats.filter(
        (chat) => chat.user_id === sourceUser.id
      )
      const chatIds = new Set(userChats.map((chat) => chat.id))
      const userNodes = backup.nodes.filter((node) => chatIds.has(node.chat_id))
      const userAttachments = backup.attachments.filter(
        (attachment) => attachment.user_id === sourceUser.id
      )
      const userLinks = backup.messageAttachments.filter((link) =>
        userNodes.some((node) => node.id === link.message_node_id)
      )
      for (const theme of backup.themes.filter(
        (theme) => theme.user_id === sourceUser.id
      ))
        await trx
          .insertInto("themes")
          .values({
            id: theme.id,
            user_id: sourceUser.id,
            name: theme.name,
            document_json: appearanceToJson(
              parseAppearance(theme.document),
              false
            ),
            created_at: theme.created_at,
            updated_at: theme.updated_at,
          })
          .execute()
      for (const stack of backup.promptStacks.filter(
        (stack) => stack.user_id === sourceUser.id
      ))
        await trx
          .insertInto("prompt_stacks")
          .values({
            id: stack.id,
            user_id: sourceUser.id,
            name: stack.name,
            stack_json: promptStackToJson(readStackJson(stack.stack_json)),
            created_at: stack.created_at,
            updated_at: stack.updated_at,
          })
          .execute()
      const prefs = backup.userPreferences.find(
        (prefs) => prefs.user_id === sourceUser.id
      )
      if (prefs)
        await trx.insertInto("user_preferences").values(prefs).execute()
      for (const chat of userChats) {
        await trx
          .insertInto("chats")
          .values({
            id: chat.id,
            user_id: sourceUser.id,
            title: chat.title,
            selected_root_node_id: chat.selected_root_node_id,
            model_config_json: chat.model_config_json,
            prompt_stack_id: chat.prompt_stack_id ?? null,
            created_at: chat.created_at,
            updated_at: chat.updated_at,
          })
          .execute()
      }
      await insertRestoredMessageNodes(trx, userNodes)
      for (const attachment of userAttachments) {
        const data = files.get(attachment.file)
        if (!data)
          throw new Error(`Backup attachment ${attachment.id} is missing`)
        const stored = await attachmentStorage.put({
          sha256: attachment.sha256,
          data,
        })
        await trx
          .insertInto("attachments")
          .values({
            id: attachment.id,
            user_id: sourceUser.id,
            filename: attachment.filename,
            media_type: attachment.media_type,
            byte_size: attachment.byte_size,
            sha256: attachment.sha256,
            storage_backend: attachmentStorage.kind,
            storage_key: stored.storageKey,
            data: stored.data,
            claimed_at: attachment.claimed_at,
            created_at: attachment.created_at,
          })
          .execute()
      }
      for (const link of userLinks)
        await trx.insertInto("message_attachments").values(link).execute()
    }
  })
}

export async function createBackup() {
  const chats = await db.selectFrom("chats").selectAll().execute()
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
    .execute()
  const promptStacks = await db
    .selectFrom("prompt_stacks")
    .selectAll()
    .execute()
  const themes = await db.selectFrom("themes").selectAll().execute()
  const mcpRows = await db
    .selectFrom("mcp_server_profiles")
    .selectAll()
    .execute()
  const mcpServerProfiles = mcpRows.map((row) =>
    mcpProfileForBackup(profileFromRow(row))
  )
  const attachmentRows = await db
    .selectFrom("attachments")
    .selectAll()
    .execute()
  const attachments = attachmentRows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
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
          .execute()
  const normalizedStacks = promptStacks.map((row) => ({
    ...row,
    stack_json: promptStackToJson(readStackJson(row.stack_json)),
  }))
  const normalizedThemes = themes.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    document: parseAppearance(
      row.document_json ? JSON.parse(row.document_json) : {}
    ),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }))
  const titleModelConfig = await getTitleModelConfig()
  const users = await db.selectFrom("user").selectAll().execute()
  const userPreferences = await db
    .selectFrom("user_preferences")
    .selectAll()
    .execute()
  return {
    version: 1 as const,
    createdAt: new Date().toISOString(),
    instance: { titleModelConfig },
    promptStacks: normalizedStacks,
    themes: normalizedThemes,
    chats,
    nodes,
    attachments,
    messageAttachments,
    providerProfiles: providers,
    mcpServerProfiles,
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      role: user.role,
      banned: user.banned,
      banReason: user.banReason,
      banExpires: user.banExpires,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })),
    userPreferences,
  }
}

export async function createBackupArchive() {
  const backup = await createBackup()
  const files = new Map<string, Uint8Array>()
  if (backup.attachments.length) {
    const rows = await db.selectFrom("attachments").selectAll().execute()
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
