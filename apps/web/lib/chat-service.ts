import "server-only"
import type { ReasoningSupport } from "@/lib/reasoning"
import { createHash } from "node:crypto"
import { sql, type Kysely, type Transaction } from "kysely"
import { db, fromDbBool, toDbBool } from "@/lib/db"
import { id, now, parseJson, subtreeNodeIds } from "@/lib/domain"
import {
  assertPartsAllowedForRole,
  durableAuthoredParts,
  isEmptyParts,
  searchTextFromParts,
} from "@/lib/agent/parts"
import { hydrateAuthoredParts } from "@/lib/conversation-attachments"
import {
  rebalanceSortKeys,
  siblingSort,
  sortKeyAfter,
  sortKeyBetween,
} from "@/lib/sort-key"
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
  AttachmentReference,
  DB,
  MessageRole,
  MessageStatus,
  AttachmentPart,
  NodeRow,
  Parts,
  PromptStackRow,
  SpaceRow,
  ThemeRow,
} from "@/lib/types"
import { generateChatTitle } from "@/lib/agent/generate-title"
import { seedChatTitle } from "@/lib/chat-title"
import { defaultModelConfig, type ModelConfig } from "@/lib/providers"
import { orderNodesForInsert, parseBackup, type Backup } from "@/lib/backup"
import {
  parseChatViewState,
  chatViewStateToJson,
  type ChatViewState,
} from "@/lib/chat-view-state"
import {
  isEnabledModelId,
  parseProviderModels,
  parseProviderModelsJson,
  providerModelsToJson,
} from "@/lib/provider-models"
import {
  providerConfigForStorage,
  providerConnectionConfigSchema,
  providerConfigFromJson,
  type ProviderConnectionConfigInput,
} from "@/lib/provider-config"
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
  sanitizePromptVariableOverrides,
  type PromptStackDocument,
  type PromptVariableValues,
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
import { parseBuiltInToolsJson } from "@/lib/agent/tools/catalog"
import {
  ensureUserSettings,
  getUserSettings,
  setUserThemeSlots,
} from "@/lib/user-settings"
import { MAX_SPACE_DEPTH, MAX_SPACES } from "@/lib/limits"
import {
  assertSpaceMoveAllowed,
  bindVariableLocksToStack,
  mergeUnlockedModelConfig,
  mergeUnlockedVariables,
  omitModelProviderRef,
  omitPromptStackRef,
  parseSpaceSettings,
  resolveChatSettings,
  spaceDescriptionSchema,
  spaceFromRow,
  spaceNameSchema,
  spaceSettingsSchema,
  spaceSettingsToJson,
  spaceDepth,
  spacesById,
  orderSpacesForInsert,
  type ResolvedChatSettings,
  type SpaceRecord,
  type SpaceSettings,
} from "@/lib/space"

function normalizeNodeRow(node: NodeRow): NodeRow {
  return {
    ...node,
    excluded_from_context: fromDbBool(node.excluded_from_context),
  }
}

type SiblingRow = Pick<NodeRow, "id" | "parent_id" | "sort_key" | "created_at">

async function listSiblings(
  executor: DbExecutor,
  chatId: string,
  parentId: string | null,
  excludeId?: string
): Promise<SiblingRow[]> {
  let query = executor
    .selectFrom("message_nodes")
    .select(["id", "parent_id", "sort_key", "created_at"])
    .where("chat_id", "=", chatId)
  query =
    parentId == null
      ? query.where("parent_id", "is", null)
      : query.where("parent_id", "=", parentId)
  if (excludeId) query = query.where("id", "!=", excludeId)
  return (await query.execute()).sort(siblingSort)
}

const NEW_SORT_SLOT = "__new__"

async function writeSortKeys(
  trx: Transaction<DB>,
  keys: Map<string, number>,
  timestamp: string
) {
  for (const [id, sort_key] of keys) {
    if (id === NEW_SORT_SLOT) continue
    await trx
      .updateTable("message_nodes")
      .set({ sort_key, updated_at: timestamp })
      .where("id", "=", id)
      .execute()
  }
}

async function allocateSortKey(
  trx: Transaction<DB>,
  input: {
    chatId: string
    parentId: string | null
    beforeNodeId?: string
    excludeId?: string
  }
) {
  const siblings = await listSiblings(
    trx,
    input.chatId,
    input.parentId,
    input.excludeId
  )
  if (!input.beforeNodeId) return sortKeyAfter(siblings.at(-1)?.sort_key)
  const beforeIndex = siblings.findIndex((row) => row.id === input.beforeNodeId)
  if (beforeIndex < 0) throw new Error("Insert target is not in this chat")
  const before = siblings[beforeIndex]!
  const prior = siblings[beforeIndex - 1]
  const mid = sortKeyBetween(prior?.sort_key, before.sort_key)
  if (mid != null) return mid
  const ids = siblings.map((row) => row.id)
  ids.splice(beforeIndex, 0, NEW_SORT_SLOT)
  const keys = rebalanceSortKeys(ids)
  await writeSortKeys(trx, keys, now())
  return keys.get(NEW_SORT_SLOT)!
}

async function prepareAuthoredParts(input: {
  userId: string
  role: Extract<MessageRole, "user" | "assistant">
  parts: Parts
  attachments?: AttachmentReference[]
  sourceParts?: Parts
}) {
  const parts = await hydrateAuthoredParts({
    userId: input.userId,
    parts: durableAuthoredParts(input.parts),
    attachments: input.attachments,
    sourceParts: input.sourceParts,
  })
  assertPartsAllowedForRole(input.role, parts)
  if (isEmptyParts(parts)) throw new Error("Message is required")
  return parts
}

async function cancelGenerationRuns(nodeIds: Iterable<string>) {
  const ids = [...nodeIds]
  if (!ids.length) return
  const runs = await db
    .selectFrom("generation_runs")
    .select("id")
    .where("node_id", "in", ids)
    .execute()
  await requestCancelGenerationRuns(runs.map((run) => run.id))
}

async function requestCancelGenerationRuns(runIds: Iterable<string>) {
  const ids = [...runIds]
  await Promise.all(
    ids.map((runId) =>
      generationStreamStore.requestCancel(runId).catch((error) => {
        // Database deletion is authoritative and cascades the run, fencing
        // later terminal writes. Stream-store cancellation is only a prompt
        // best-effort signal to a still-running producer.
        console.warn("[nibchat/generation-cancel]", runId, error)
      })
    )
  )
}

type DbExecutor = Kysely<DB> | Transaction<DB>

/** Acquire the per-chat write lock before reading or changing its graph. */
async function lockChatMutation(
  trx: Transaction<DB>,
  chatId: string,
  userId?: string
) {
  const timestamp = now()
  const result = userId
    ? await trx
        .updateTable("chats")
        .set({ updated_at: timestamp })
        .where("id", "=", chatId)
        .where("user_id", "=", userId)
        .executeTakeFirst()
    : await trx
        .updateTable("chats")
        .set({ updated_at: timestamp })
        .where("id", "=", chatId)
        .executeTakeFirst()
  if (Number(result.numUpdatedRows ?? 0) !== 1)
    throw new Error("Chat not found")
}

async function assertChatOwner(
  chatId: string,
  userId: string,
  executor: DbExecutor = db
) {
  const chat = await executor
    .selectFrom("chats")
    .select("id")
    .where("id", "=", chatId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!chat) throw new Error("Chat not found")
  return chat
}

async function listSpaceRows(
  userId: string,
  executor: DbExecutor = db
): Promise<SpaceRow[]> {
  return await executor
    .selectFrom("spaces")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("sort_key")
    .orderBy("created_at")
    .execute()
}

async function rewriteSpaceSettings(
  rewrite: (settings: SpaceSettings) => SpaceSettings,
  executor: DbExecutor = db,
  userId?: string
) {
  let query = executor
    .selectFrom("spaces")
    .select(["id", "user_id", "settings_json"])
  if (userId) query = query.where("user_id", "=", userId)
  const rows = await query.execute()
  const timestamp = now()
  for (const row of rows) {
    const current = parseSpaceSettings(row.settings_json)
    const next = rewrite(current)
    if (JSON.stringify(next) === JSON.stringify(current)) continue
    await executor
      .updateTable("spaces")
      .set({
        settings_json: spaceSettingsToJson(next),
        updated_at: timestamp,
      })
      .where("id", "=", row.id)
      .execute()
  }
}

async function loadSpaceRecords(userId: string): Promise<SpaceRecord[]> {
  return (await listSpaceRows(userId)).map(spaceFromRow)
}

async function assertSpaceOwner(spaceId: string, userId: string) {
  const space = await db
    .selectFrom("spaces")
    .selectAll()
    .where("id", "=", spaceId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!space) throw new Error("Space not found")
  return space
}

function nextSpaceSortKey(
  rows: readonly SpaceRow[],
  parentId: string | null,
  exceptId?: string
) {
  const siblings = rows.filter(
    (space) => space.parent_id === parentId && space.id !== exceptId
  )
  const maxKey = siblings.reduce(
    (max, space) => Math.max(max, space.sort_key),
    0
  )
  return sortKeyAfter(maxKey || null)
}

async function assertSpaceSettingsStack(
  userId: string,
  settings: SpaceSettings
) {
  const stackId = settings.promptStack?.value
  if (!stackId) return
  const existing = await db
    .selectFrom("prompt_stacks")
    .select("id")
    .where("id", "=", stackId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!existing) throw new Error("Prompt stack not found")
}

export async function resolveSettingsForChat(
  chat: {
    space_id?: string | null
    prompt_stack_id: string | null
    variables_json?: string
    model_config_json?: string
  },
  userId: string,
  spaces?: readonly SpaceRecord[]
): Promise<ResolvedChatSettings> {
  const records = spaces ?? (await loadSpaceRecords(userId))
  return resolveChatSettings({
    chat: {
      spaceId: chat.space_id ?? null,
      promptStackId: chat.prompt_stack_id,
      variables: parseJson<Record<string, unknown>>(
        chat.variables_json ?? "{}",
        {}
      ),
      model: parseJson<ModelConfig>(chat.model_config_json ?? "{}", {}),
    },
    spaces: records,
  })
}

async function assertNodeOwner(
  nodeId: string,
  userId: string,
  executor: DbExecutor = db
) {
  const row = await executor
    .selectFrom("message_nodes")
    .innerJoin("chats", "chats.id", "message_nodes.chat_id")
    .select([
      "message_nodes.id",
      "message_nodes.chat_id",
      "message_nodes.parent_id",
      "message_nodes.selected_child_id",
      "message_nodes.sort_key",
      "message_nodes.revision",
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
  const spaces = await listSpaceRows(userId)
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
    spaces,
    chat: selected ?? null,
    nodes: nodes.map((node) => normalizeNodeRow(node)),
    activeGenerations,
  }
}

export async function createChat(
  userId: string,
  title: string | null = null,
  config?: ModelConfig,
  promptStackId?: string | null,
  variables?: PromptVariableValues,
  spaceId?: string | null
) {
  const baseline = await defaultModelConfig(userId)
  const incoming =
    config && (config.providerId || config.model) ? config : baseline
  if (promptStackId) {
    const existing = await db
      .selectFrom("prompt_stacks")
      .select("id")
      .where("id", "=", promptStackId)
      .where("user_id", "=", userId)
      .executeTakeFirst()
    if (!existing) throw new Error("Prompt stack not found")
  }
  const resolvedSpaceId = spaceId ?? null
  if (resolvedSpaceId) await assertSpaceOwner(resolvedSpaceId, userId)
  const lockPreview = await resolveSettingsForChat(
    {
      space_id: resolvedSpaceId,
      prompt_stack_id: promptStackId ?? null,
      model_config_json: JSON.stringify(incoming),
      variables_json: "{}",
    },
    userId
  )
  const storedModel = mergeUnlockedModelConfig(
    baseline,
    incoming,
    lockPreview.locks
  )
  const storedVariables =
    variables && Object.keys(variables).length > 0
      ? sanitizePromptVariableOverrides(
          (
            await resolveStackForChat(
              {
                prompt_stack_id: promptStackId ?? null,
                space_id: resolvedSpaceId,
                model_config_json: JSON.stringify(storedModel),
                variables_json: "{}",
              },
              userId
            )
          ).stack.variables ?? [],
          mergeUnlockedVariables(
            {},
            variables,
            lockPreview.locks,
            Object.keys(variables)
          )
        )
      : {}
  const timestamp = now()
  const chat = {
    id: id(),
    user_id: userId,
    title,
    selected_root_node_id: null,
    model_config_json: JSON.stringify(storedModel),
    view_state_json: chatViewStateToJson({ mode: "linear", camera: null }),
    prompt_stack_id: lockPreview.locks.promptStack
      ? null
      : (promptStackId ?? null),
    variables_json: JSON.stringify(storedVariables),
    space_id: resolvedSpaceId,
    created_at: timestamp,
    updated_at: timestamp,
  }
  await db.insertInto("chats").values(chat).execute()
  return chat
}

export async function deleteChat(userId: string, chatId: string) {
  const deletion = await db.transaction().execute(async (trx) => {
    await lockChatMutation(trx, chatId, userId)
    const nodeIds = await trx
      .selectFrom("message_nodes")
      .select("id")
      .where("chat_id", "=", chatId)
      .execute()
    const generationRunIds = nodeIds.length
      ? await trx
          .selectFrom("generation_runs")
          .select("id")
          .where(
            "node_id",
            "in",
            nodeIds.map((node) => node.id)
          )
          .execute()
      : []
    await trx
      .deleteFrom("chats")
      .where("id", "=", chatId)
      .where("user_id", "=", userId)
      .execute()
    return {
      nodeIds: nodeIds.map((node) => node.id),
      generationRunIds: generationRunIds.map((run) => run.id),
    }
  })
  abortGenerations(deletion.nodeIds)
  await requestCancelGenerationRuns(deletion.generationRunIds)
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
  sortKey?: number
  trx?: Transaction<DB>
}): Promise<NodeRow> {
  if (!input.trx)
    return db.transaction().execute((trx) => insertNode({ ...input, trx }))
  await lockChatMutation(input.trx, input.chatId)
  assertPartsAllowedForRole(input.role, input.parts)
  const timestamp = now()
  const attachSelection = input.attachSelection !== false
  const node = {
    id: id(),
    chat_id: input.chatId,
    parent_id: input.parentId,
    selected_child_id: null,
    sort_key: input.sortKey ?? 0,
    revision: 0,
    role: input.role,
    parts_json: JSON.stringify(input.parts),
    search_text: searchTextFromParts(input.parts),
    metadata_json: JSON.stringify(input.metadata ?? {}),
    excluded_from_context: toDbBool(false),
    status: input.status ?? ("complete" as const),
    created_at: timestamp,
    updated_at: timestamp,
  }
  const persist = async (trx: Transaction<DB>) => {
    node.sort_key =
      input.sortKey ??
      (await allocateSortKey(trx, {
        chatId: input.chatId,
        parentId: input.parentId,
      }))
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
  }
  await persist(input.trx)
  return node
}

/**
 * Save one authored conversation message. Generation is deliberately a
 * separate operation, allowing either role to follow either role.
 */
export async function createMessage(input: {
  userId: string
  chatId: string
  parentId: string | null
  /** Insert immediately before this sibling/root message. */
  beforeNodeId?: string
  role: Extract<MessageRole, "user" | "assistant">
  parts: Parts
  attachments?: AttachmentReference[]
  metadata?: Record<string, unknown>
  /** Opt-in; omitted means the view selection is left unchanged. */
  attachSelection?: boolean
  trx?: Transaction<DB>
}): Promise<NodeRow> {
  if (!input.trx)
    return db.transaction().execute((trx) => createMessage({ ...input, trx }))
  const executor = input.trx
  await lockChatMutation(input.trx, input.chatId, input.userId)
  await assertChatOwner(input.chatId, input.userId, executor)
  let parentId = input.parentId
  if (input.beforeNodeId) {
    const before = await assertNodeOwner(
      input.beforeNodeId,
      input.userId,
      executor
    )
    if (before.chat_id !== input.chatId)
      throw new Error("Insert target is not in this chat")
    parentId = before.parent_id
  }
  if (parentId) {
    const parent = await executor
      .selectFrom("message_nodes")
      .select("id")
      .where("id", "=", parentId)
      .where("chat_id", "=", input.chatId)
      .executeTakeFirst()
    if (!parent) throw new Error("Parent node not found in chat")
  }
  const parts = await prepareAuthoredParts({
    userId: input.userId,
    role: input.role,
    parts: input.parts,
    attachments: input.attachments,
  })
  const persist = async (trx: Transaction<DB>) => {
    const sortKey = await allocateSortKey(trx, {
      chatId: input.chatId,
      parentId,
      beforeNodeId: input.beforeNodeId,
    })
    const node = await insertNode({
      chatId: input.chatId,
      parentId,
      role: input.role,
      parts,
      metadata: input.metadata,
      attachSelection: input.attachSelection === true,
      sortKey,
      trx,
    })
    if (input.role === "user") {
      const attachments = parts.filter(
        (part): part is AttachmentPart => part.type === "attachment"
      )
      if (attachments.length)
        await claimUploadedAttachments(input.userId, node.id, attachments, trx)
    }
    return node
  }
  return persist(input.trx)
}

/** Create a streaming assistant message beneath an explicit context leaf. */
export async function startGeneration(input: {
  userId: string
  chatId: string
  parentId: string | null
  generationId: string
  assistantMetadata?: Record<string, unknown>
  /** Opt-in; omitted means the view selection is left unchanged. */
  attachSelection?: boolean
  trx?: Transaction<DB>
}): Promise<{ assistant: NodeRow; contextLeafId: string | null }> {
  if (!input.trx)
    return db.transaction().execute((trx) => startGeneration({ ...input, trx }))
  const executor = input.trx
  await lockChatMutation(input.trx, input.chatId, input.userId)
  await assertChatOwner(input.chatId, input.userId, executor)
  if (input.parentId) {
    const parent = await executor
      .selectFrom("message_nodes")
      .select("id")
      .where("id", "=", input.parentId)
      .where("chat_id", "=", input.chatId)
      .executeTakeFirst()
    if (!parent) throw new Error("Parent node not found in chat")
  }
  const assistant = await insertNode({
    chatId: input.chatId,
    parentId: input.parentId,
    role: "assistant",
    parts: [],
    status: "streaming",
    metadata: input.assistantMetadata,
    generationId: input.generationId,
    attachSelection: input.attachSelection === true,
    trx: input.trx,
  })
  return { assistant, contextLeafId: input.parentId }
}

/** User message + streaming assistant in one transaction. */
export async function submitUserTurn(input: {
  userId: string
  chatId: string
  parentId: string | null
  parts: Parts
  generationId: string
  assistantMetadata?: Record<string, unknown>
  attachSelection?: boolean
}) {
  return db.transaction().execute(async (trx) => {
    const user = await createMessage({
      userId: input.userId,
      chatId: input.chatId,
      parentId: input.parentId,
      role: "user",
      parts: input.parts,
      attachSelection: input.attachSelection,
      trx,
    })
    const generation = await startGeneration({
      userId: input.userId,
      chatId: input.chatId,
      parentId: user.id,
      generationId: input.generationId,
      assistantMetadata: input.assistantMetadata,
      attachSelection: input.attachSelection,
      trx,
    })
    return { user, assistant: generation.assistant, contextLeafId: user.id }
  })
}

/**
 * User-edit continue: the new turn is a sibling of this node, so MCP snapshots
 * on it may be copied instead of re-read from the live server.
 */
export async function loadEditSourceUserNode(
  userId: string,
  chatId: string,
  nodeId: string,
  parentId: string | null
) {
  const node = await assertNodeOwner(nodeId, userId)
  if (node.chat_id !== chatId)
    throw new Error("Edited message is not in this chat")
  if (node.role !== "user")
    throw new Error("Only user messages can be edited as a branch")
  if ((node.parent_id ?? null) !== parentId)
    throw new Error("Edited message is not under this parent")
  return node
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
  let modelJson: string | undefined
  if (patch.model) {
    if (!userId) throw new Error("Chat not found")
    const chat = await db
      .selectFrom("chats")
      .select([
        "space_id",
        "prompt_stack_id",
        "model_config_json",
        "variables_json",
      ])
      .where("id", "=", chatId)
      .where("user_id", "=", userId)
      .executeTakeFirst()
    if (!chat) throw new Error("Chat not found")
    const resolved = await resolveSettingsForChat(chat, userId)
    const stored = parseJson<ModelConfig>(chat.model_config_json, {})
    modelJson = JSON.stringify(
      mergeUnlockedModelConfig(stored, patch.model, resolved.locks)
    )
  }
  await db
    .updateTable("chats")
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(modelJson ? { model_config_json: modelJson } : {}),
      updated_at: now(),
    })
    .where("id", "=", chatId)
    .execute()
}

/** Persist presentation separately so moving around a tree never reorders chats. */
export async function setChatViewState(
  userId: string,
  chatId: string,
  state: ChatViewState
) {
  await assertChatOwner(chatId, userId)
  if (state.camera) {
    const anchor = await db
      .selectFrom("message_nodes")
      .select("id")
      .where("id", "=", state.camera.anchorNodeId)
      .where("chat_id", "=", chatId)
      .executeTakeFirst()
    if (!anchor) throw new Error("Tree camera anchor not found")
  }
  await db
    .updateTable("chats")
    .set({ view_state_json: chatViewStateToJson(state) })
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
          chatId: input.chatId,
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
  return db.transaction().execute(async (trx) => {
    await lockChatMutation(trx, chatId, userId)
    return selectPathInTransaction(trx, userId, chatId, nodeId)
  })
}

async function selectPathInTransaction(
  trx: Transaction<DB>,
  userId: string,
  chatId: string,
  nodeId: string
) {
  await assertChatOwner(chatId, userId, trx)
  const nodes = await trx
    .selectFrom("message_nodes")
    .selectAll()
    .where("chat_id", "=", chatId)
    .execute()
  const byId = new Map(nodes.map((node) => [node.id, node]))
  if (!byId.has(nodeId)) throw new Error("Node not found")
  const path: NodeRow[] = []
  const seen = new Set<string>()
  let current: NodeRow | undefined = byId.get(nodeId)
  while (current) {
    if (seen.has(current.id)) throw new Error("Message graph contains a cycle")
    seen.add(current.id)
    path.unshift(current)
    if (current.parent_id && !byId.has(current.parent_id))
      throw new Error("Message graph contains a missing parent")
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  const timestamp = now()
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
}

/** Branch an authored complete parts document. This is the canonical path for
 * tool-record editing: it stores history only and never schedules execution. */
export async function forkMessageParts(input: {
  userId: string
  nodeId: string
  parts: Parts
  attachments?: AttachmentReference[]
  role?: Extract<MessageRole, "user" | "assistant">
  attachSelection?: boolean
}) {
  const original = await assertNodeOwner(input.nodeId, input.userId)
  if (original.status === "awaiting_input")
    throw new Error("Cannot edit a message that is still in progress.")
  const role =
    input.role ?? (original.role as Extract<MessageRole, "user" | "assistant">)
  if (role !== "user" && role !== "assistant")
    throw new Error("Only user and assistant messages can be edited.")
  const parts = await prepareAuthoredParts({
    userId: input.userId,
    role,
    parts: input.parts,
    attachments: input.attachments,
    sourceParts: nodeParts(original),
  })
  return persistForkedMessage({
    userId: input.userId,
    original,
    role,
    parts,
    attachSelection: input.attachSelection,
  })
}

async function persistForkedMessage(input: {
  userId: string
  original: NodeRow
  parts: Parts
  role?: Extract<MessageRole, "user" | "assistant">
  attachSelection?: boolean
}) {
  const role =
    input.role ??
    (input.original.role as Extract<MessageRole, "user" | "assistant">)
  return db.transaction().execute(async (trx) => {
    await lockChatMutation(trx, input.original.chat_id, input.userId)
    const original = await assertNodeOwner(input.original.id, input.userId, trx)
    const node = await insertNode({
      chatId: original.chat_id,
      parentId: original.parent_id,
      role,
      parts: input.parts,
      metadata: {
        ...parseJson<Record<string, unknown>>(original.metadata_json, {}),
        provenance: "owner-edited",
        editedFrom: original.id,
      },
      attachSelection: input.attachSelection,
      trx,
    })
    await claimUploadedAttachments(
      input.userId,
      node.id,
      input.parts.filter(
        (part): part is AttachmentPart => part.type === "attachment"
      ),
      trx
    )
    return node
  })
}

/** New streaming assistant as a sibling of an existing assistant (any parent role). */
export async function startRegenerate(
  userId: string,
  assistantNodeId: string,
  generationId?: string,
  assistantMetadata: Record<string, unknown> = {}
) {
  const target = await assertNodeOwner(assistantNodeId, userId)
  return db.transaction().execute(async (trx) => {
    await lockChatMutation(trx, target.chat_id, userId)
    const original = await assertNodeOwner(assistantNodeId, userId, trx)
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
      trx,
    })
    return {
      assistant,
      contextLeafId: original.parent_id as string | null,
    }
  })
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

/** Canonical durable snapshot for the terminal generation transport event. */
export type StreamFinalization = {
  result: StreamFinalizeResult
  node: NodeRow | null
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

function persistAssistantMetadata(
  previous: Record<string, unknown>,
  fields: Record<string, unknown>
) {
  return JSON.stringify({ ...previous, ...fields })
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
        metadata_json: persistAssistantMetadata(previous, {
          ...(config?.providerId != null
            ? { provider: config.providerId }
            : {}),
          ...(config?.model != null ? { model: config.model } : {}),
          ...(config ? { generationConfig: config } : {}),
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
        metadata_json: persistAssistantMetadata(previous, {
          ...(config?.providerId != null
            ? { provider: config.providerId }
            : {}),
          ...(config?.model != null ? { model: config.model } : {}),
          pausedAt: new Date().toISOString(),
          ...(input.finishReason != null
            ? { finishReason: input.finishReason }
            : {}),
          ...(input.usage !== undefined ? { usage: input.usage } : {}),
          ...(config ? { generationConfig: config } : {}),
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
      metadata_json: persistAssistantMetadata(previous, {
        ...(config?.providerId != null ? { provider: config.providerId } : {}),
        ...(config?.model != null ? { model: config.model } : {}),
        finishedAt: new Date().toISOString(),
        ...(input.finishReason != null
          ? { finishReason: input.finishReason }
          : {}),
        ...(input.usage !== undefined ? { usage: input.usage } : {}),
        ...(config ? { generationConfig: config } : {}),
      }),
      updated_at: now(),
    })
    .where("id", "=", input.nodeId)
    .execute()
  return finishRun("complete")
}

/**
 * Finalize then read the durable row used by connected clients for an atomic
 * renderer handoff. Terminal failures intentionally carry no speculative row.
 */
export async function finalizeStreamingAssistantWithSnapshot(
  input: StreamFinalizeInput
): Promise<StreamFinalization> {
  const result = await finalizeStreamingAssistant(input)
  if (result === "deleted" || result === "missing" || result === "superseded")
    return { result, node: null }
  const node = await db
    .selectFrom("message_nodes")
    .selectAll()
    .where("id", "=", input.nodeId)
    .executeTakeFirst()
  return { result, node: node ? normalizeNodeRow(node as NodeRow) : null }
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
  const target = await db
    .selectFrom("message_nodes")
    .select("chat_id")
    .where("id", "=", nodeId)
    .executeTakeFirst()
  if (!target) return "missing"
  return db.transaction().execute(async (trx) => {
    await lockChatMutation(trx, target.chat_id)
    const node = await trx
      .selectFrom("message_nodes")
      .selectAll()
      .where("id", "=", nodeId)
      .executeTakeFirst()
    if (!node) return "missing"
    if (node.status !== "streaming") return "superseded"
    const child = await trx
      .selectFrom("message_nodes")
      .select("id")
      .where("parent_id", "=", node.id)
      .executeTakeFirst()
    if (child) return "superseded"
    const chat = await trx
      .selectFrom("chats")
      .select("view_state_json")
      .where("id", "=", node.chat_id)
      .executeTakeFirst()
    if (chat) {
      const state = parseChatViewState(chat.view_state_json)
      if (state.camera?.anchorNodeId === node.id)
        await trx
          .updateTable("chats")
          .set({
            view_state_json: chatViewStateToJson({ ...state, camera: null }),
          })
          .where("id", "=", node.chat_id)
          .execute()
    }
    const timestamp = now()
    const replacement = await replacementSiblingId(trx, node)
    await repairSelectionAfterDetach(trx, node, replacement, timestamp)
    await trx.deleteFrom("message_nodes").where("id", "=", node.id).execute()
    return "deleted"
  })
}

export async function deleteNode(
  userId: string,
  nodeId: string,
  mode: "subtree" | "reparent"
) {
  const target = await db
    .selectFrom("message_nodes")
    .select("chat_id")
    .where("id", "=", nodeId)
    .execute()
  const chatId = target[0]?.chat_id
  if (!chatId) throw new Error("Message not found")
  const deletion = await deleteNodeInternal(nodeId, chatId, userId, mode)
  abortGenerations(deletion.nodeIds)
  await requestCancelGenerationRuns(deletion.generationRunIds)
  await cleanupDetachedAttachments()
}

/** A deleted anchor cannot be restored meaningfully, but its view mode can. */
async function clearDeletedTreeCamera(
  executor: DbExecutor,
  chatId: string,
  deletedIds: ReadonlySet<string>
) {
  const chat = await executor
    .selectFrom("chats")
    .select("view_state_json")
    .where("id", "=", chatId)
    .executeTakeFirst()
  if (!chat) return
  const state = parseChatViewState(chat.view_state_json)
  if (!state.camera || !deletedIds.has(state.camera.anchorNodeId)) return
  await executor
    .updateTable("chats")
    .set({ view_state_json: chatViewStateToJson({ ...state, camera: null }) })
    .where("id", "=", chatId)
    .execute()
}

/** Delete under the chat lock and return the exact committed deletion targets. */
async function deleteNodeInternal(
  nodeId: string,
  chatId: string,
  userId: string,
  mode: "subtree" | "reparent"
) {
  return db.transaction().execute(async (trx) => {
    await lockChatMutation(trx, chatId, userId)
    const node = await assertNodeOwner(nodeId, userId, trx)
    if (node.chat_id !== chatId) throw new Error("Message not found")
    const deletedIds =
      mode === "subtree"
        ? [
            ...subtreeNodeIds(
              await trx
                .selectFrom("message_nodes")
                .select(["id", "parent_id"])
                .where("chat_id", "=", chatId)
                .execute(),
              node.id
            ),
          ]
        : [node.id]
    const generationRunIds = deletedIds.length
      ? await trx
          .selectFrom("generation_runs")
          .select("id")
          .where("node_id", "in", deletedIds)
          .execute()
      : []
    await clearDeletedTreeCamera(trx, chatId, new Set(deletedIds))
    const timestamp = now()
    if (mode === "reparent") {
      const children = await trx
        .selectFrom("message_nodes")
        .selectAll()
        .where("parent_id", "=", node.id)
        .execute()
      for (const child of children)
        await trx
          .updateTable("message_nodes")
          .set({ parent_id: node.parent_id, updated_at: timestamp })
          .where("id", "=", child.id)
          .execute()
      const selectedChild =
        children.find((child) => child.id === node.selected_child_id) ??
        children[0]
      if (node.parent_id) {
        const parent = await trx
          .selectFrom("message_nodes")
          .select(["selected_child_id"])
          .where("id", "=", node.parent_id)
          .executeTakeFirst()
        if (!parent || parent.selected_child_id === node.id)
          await trx
            .updateTable("message_nodes")
            .set({
              selected_child_id: selectedChild?.id ?? null,
              updated_at: timestamp,
            })
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
            .set({
              selected_root_node_id: selectedChild?.id ?? null,
              updated_at: timestamp,
            })
            .where("id", "=", node.chat_id)
            .execute()
      }
      await trx.deleteFrom("message_nodes").where("id", "=", node.id).execute()
      return {
        nodeIds: deletedIds,
        generationRunIds: generationRunIds.map((run) => run.id),
      }
    }
    const replacement = await replacementSiblingId(trx, node)
    await repairSelectionAfterDetach(trx, node, replacement, timestamp)
    await trx.deleteFrom("message_nodes").where("id", "=", node.id).execute()
    return {
      nodeIds: deletedIds,
      generationRunIds: generationRunIds.map((run) => run.id),
    }
  })
}

/** Move a message or its full subtree to another position in the same chat. */
export async function moveNode(input: {
  userId: string
  nodeId: string
  destinationParentId: string | null
  beforeNodeId?: string
  subtree: boolean
}) {
  const timestamp = now()
  const target = await db
    .selectFrom("message_nodes")
    .select("chat_id")
    .where("id", "=", input.nodeId)
    .executeTakeFirst()
  if (!target) throw new Error("Node not found")
  let parentChanged = false
  await db.transaction().execute(async (trx) => {
    // Lock the chat row before reading the graph. This serializes structural
    // mutations for this chat on both PostgreSQL and SQLite.
    await lockChatMutation(trx, target.chat_id, input.userId)
    const node = await assertNodeOwner(input.nodeId, input.userId, trx)
    const nodes = await trx
      .selectFrom("message_nodes")
      .selectAll()
      .where("chat_id", "=", node.chat_id)
      .execute()
    let destinationParentId = input.destinationParentId
    if (input.beforeNodeId) {
      const before = nodes.find((row) => row.id === input.beforeNodeId)
      if (!before) throw new Error("Insert target not found in chat")
      destinationParentId = before.parent_id
    }
    if (destinationParentId === node.id)
      throw new Error("A message cannot be its own parent")
    const descendants = subtreeNodeIds(nodes, node.id)
    if (destinationParentId && descendants.has(destinationParentId))
      throw new Error("A message cannot be moved beneath its descendant")
    if (
      destinationParentId &&
      !nodes.some((row) => row.id === destinationParentId)
    )
      throw new Error("Destination node not found in chat")
    parentChanged = (node.parent_id ?? null) !== (destinationParentId ?? null)
    if (!input.subtree) {
      const children = nodes.filter((row) => row.parent_id === node.id)
      for (const child of children)
        await trx
          .updateTable("message_nodes")
          .set({ parent_id: node.parent_id, updated_at: timestamp })
          .where("id", "=", child.id)
          .execute()
    }
    const sortKey = await allocateSortKey(trx, {
      chatId: node.chat_id,
      parentId: destinationParentId,
      beforeNodeId: input.beforeNodeId,
      excludeId: node.id,
    })
    await trx
      .updateTable("message_nodes")
      .set({
        parent_id: destinationParentId,
        sort_key: sortKey,
        ...(!input.subtree ? { selected_child_id: null } : {}),
        updated_at: timestamp,
      })
      .where("id", "=", node.id)
      .execute()
    if (!parentChanged) return
    const replacement = await replacementSiblingId(trx, node)
    await repairSelectionAfterDetach(trx, node, replacement, timestamp)
    await selectPathInTransaction(trx, input.userId, node.chat_id, node.id)
  })
}

/** Replace a durable message body. Setting a live node complete fences later
 * stream terminal writes; the caller has already requested producer cancel. */
export async function replaceMessage(input: {
  userId: string
  nodeId: string
  parts: Parts
  attachments?: AttachmentReference[]
  role?: Extract<MessageRole, "user" | "assistant">
  expectedRevision?: number
}) {
  const node = await assertNodeOwner(input.nodeId, input.userId)
  if (node.status === "awaiting_input")
    throw new Error("Cannot edit a message that is still in progress.")
  const role =
    input.role ?? (node.role as Extract<MessageRole, "user" | "assistant">)
  if (role !== "user" && role !== "assistant")
    throw new Error("Only user and assistant messages can be replaced.")
  const parts = await prepareAuthoredParts({
    userId: input.userId,
    role,
    parts: input.parts,
    attachments: input.attachments,
    sourceParts: nodeParts(node),
  })
  if (node.status === "streaming") {
    abortGenerations([node.id])
    await cancelGenerationRuns([node.id])
  }
  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom("generation_runs")
      .where("node_id", "=", node.id)
      .execute()
    await trx
      .deleteFrom("message_attachments")
      .where("message_node_id", "=", node.id)
      .execute()
    const result = await trx
      .updateTable("message_nodes")
      .set({
        role,
        parts_json: JSON.stringify(parts),
        search_text: searchTextFromParts(parts),
        status: "complete",
        revision: node.revision + 1,
        metadata_json: JSON.stringify({
          ...parseJson<Record<string, unknown>>(node.metadata_json, {}),
          provenance: "owner-edited",
          replacedAt: now(),
        }),
        updated_at: now(),
      })
      .where("id", "=", node.id)
      .where("revision", "=", input.expectedRevision ?? node.revision)
      .executeTakeFirst()
    if (Number(result.numUpdatedRows ?? 0) !== 1)
      throw new Error("Message changed before it could be replaced.")
    await claimUploadedAttachments(
      input.userId,
      node.id,
      parts.filter(
        (part): part is AttachmentPart => part.type === "attachment"
      ),
      trx
    )
  })
  await cleanupDetachedAttachments()
  return node
}

async function replacementSiblingId(
  trx: Transaction<DB>,
  node: Pick<NodeRow, "id" | "chat_id" | "parent_id">
) {
  const siblings = await listSiblings(
    trx,
    node.chat_id,
    node.parent_id,
    node.id
  )
  return siblings.at(-1)?.id ?? null
}

async function repairSelectionAfterDetach(
  trx: Transaction<DB>,
  node: Pick<NodeRow, "id" | "chat_id" | "parent_id">,
  replacementId: string | null,
  timestamp: string
) {
  if (node.parent_id) {
    await trx
      .updateTable("message_nodes")
      .set({ selected_child_id: replacementId, updated_at: timestamp })
      .where("id", "=", node.parent_id)
      .where("selected_child_id", "=", node.id)
      .execute()
    return
  }
  await trx
    .updateTable("chats")
    .set({ selected_root_node_id: replacementId, updated_at: timestamp })
    .where("id", "=", node.chat_id)
    .where("selected_root_node_id", "=", node.id)
    .execute()
}

type ProviderProfileInput = {
  name: string
  kind: "openai" | "anthropic" | "ollama" | "openai-compatible"
  config: ProviderConnectionConfigInput
  models: Array<{
    id: string
    label?: string
    enabled: boolean
    source: "catalog" | "custom"
    pdfInput: "native" | "extracted"
    protocol?: "auto" | "responses" | "chat"
    reasoning?: ReasoningSupport
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
    config_json: JSON.stringify(
      providerConfigForStorage(
        providerConnectionConfigSchema.parse(profile.config)
      )
    ),
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
      config_json: JSON.stringify(
        providerConfigForStorage(
          providerConnectionConfigSchema.parse(profile.config)
        )
      ),
      models_json: providerModelsToJson(parseProviderModels(profile.models)),
      updated_at: now(),
    })
    .where("id", "=", providerId)
    .execute()
  await clearTitleModelIfUnavailable()
}

export async function deleteProvider(userId: string, providerId: string) {
  await db.transaction().execute(async (trx) => {
    await rewriteSpaceSettings(
      (settings) => omitModelProviderRef(settings, providerId),
      trx
    )
    await trx
      .deleteFrom("provider_profiles")
      .where("id", "=", providerId)
      .execute()
  })
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
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable("chats")
      .set({ prompt_stack_id: null })
      .where("prompt_stack_id", "=", stackId)
      .where("user_id", "=", userId)
      .execute()
    await rewriteSpaceSettings(
      (settings) => omitPromptStackRef(settings, stackId),
      trx,
      userId
    )
    await trx
      .deleteFrom("prompt_stacks")
      .where("id", "=", stackId)
      .where("user_id", "=", userId)
      .execute()
  })
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
  const chat = await db
    .selectFrom("chats")
    .select([
      "id",
      "space_id",
      "prompt_stack_id",
      "model_config_json",
      "variables_json",
    ])
    .where("id", "=", chatId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!chat) throw new Error("Chat not found")
  const resolved = await resolveSettingsForChat(chat, userId)
  if (resolved.locks.promptStack) {
    throw new Error(
      `Prompt stack is locked by ${resolved.locks.promptStack.spaceName}`
    )
  }
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

export async function setChatVariables(input: {
  userId: string
  chatId: string
  values: PromptVariableValues
}) {
  const chat = await db
    .selectFrom("chats")
    .select([
      "id",
      "prompt_stack_id",
      "space_id",
      "model_config_json",
      "variables_json",
    ])
    .where("id", "=", input.chatId)
    .where("user_id", "=", input.userId)
    .executeTakeFirst()
  if (!chat) throw new Error("Chat not found")
  const settings = await resolveSettingsForChat(chat, input.userId)
  const resolved = await resolveStackForChat(chat, input.userId)
  const declared = (resolved.stack.variables ?? []).map(
    (variable) => variable.name
  )
  const locks = bindVariableLocksToStack(settings.locks, declared)
  const stored = parseJson<Record<string, unknown>>(chat.variables_json, {})
  const merged = mergeUnlockedVariables(stored, input.values, locks, declared)
  const values = sanitizePromptVariableOverrides(
    resolved.stack.variables ?? [],
    merged
  )
  await db
    .updateTable("chats")
    .set({ variables_json: JSON.stringify(values), updated_at: now() })
    .where("id", "=", input.chatId)
    .where("user_id", "=", input.userId)
    .execute()
  return { ok: true as const, variables: values }
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
    space_id?: string | null
    variables_json?: string
    model_config_json?: string
  },
  userId: string
) {
  const prefs = await ensureUserSettings(userId)
  const stacksById = await loadStacksById(userId)
  const settings = await resolveSettingsForChat(chat, userId)
  return resolvePromptStack({
    chatStackId: settings.effective.promptStackId,
    defaultStackId: prefs.default_prompt_stack_id,
    stacksById,
  })
}

export async function createSpace(input: {
  userId: string
  parentId?: string | null
  name?: string
  description?: string
  settings?: SpaceSettings
}) {
  const settings = spaceSettingsSchema.parse(input.settings ?? {})
  await assertSpaceSettingsStack(input.userId, settings)
  const settingsJson = spaceSettingsToJson(settings)
  const name = spaceNameSchema.parse(input.name ?? "New space")
  const description = spaceDescriptionSchema.parse(input.description ?? "")
  const parentId = input.parentId ?? null

  return await db.transaction().execute(async (trx) => {
    const rows = await listSpaceRows(input.userId, trx)
    if (rows.length >= MAX_SPACES) {
      throw new Error(`You can create at most ${MAX_SPACES} spaces`)
    }
    const records = rows.map(spaceFromRow)
    if (parentId) {
      if (!records.some((space) => space.id === parentId)) {
        throw new Error("Space not found")
      }
      if (spaceDepth(parentId, spacesById(records)) >= MAX_SPACE_DEPTH) {
        throw new Error(`Spaces can nest at most ${MAX_SPACE_DEPTH} levels`)
      }
    }
    const timestamp = now()
    const row = {
      id: id(),
      user_id: input.userId,
      parent_id: parentId,
      sort_key: nextSpaceSortKey(rows, parentId),
      name,
      description,
      metadata_json: "{}",
      settings_json: settingsJson,
      created_at: timestamp,
      updated_at: timestamp,
    }
    await trx.insertInto("spaces").values(row).execute()
    return row
  })
}

export async function updateSpace(input: {
  userId: string
  spaceId: string
  name?: string
  description?: string
  settings?: SpaceSettings
  parentId?: string | null
}) {
  const row = await assertSpaceOwner(input.spaceId, input.userId)
  const rows = await listSpaceRows(input.userId)
  const records = rows.map(spaceFromRow)
  const parentId = input.parentId === undefined ? row.parent_id : input.parentId
  if (parentId) {
    if (!records.some((space) => space.id === parentId)) {
      throw new Error("Space not found")
    }
  }
  if (parentId !== row.parent_id) {
    assertSpaceMoveAllowed(input.spaceId, parentId, records)
  }
  let settingsJson: string | undefined
  if (input.settings !== undefined) {
    const settings = spaceSettingsSchema.parse(input.settings)
    await assertSpaceSettingsStack(input.userId, settings)
    settingsJson = spaceSettingsToJson(settings)
  }
  const moving = parentId !== row.parent_id
  await db
    .updateTable("spaces")
    .set({
      ...(input.name !== undefined
        ? { name: spaceNameSchema.parse(input.name) }
        : {}),
      ...(input.description !== undefined
        ? { description: spaceDescriptionSchema.parse(input.description) }
        : {}),
      ...(settingsJson ? { settings_json: settingsJson } : {}),
      ...(input.parentId !== undefined ? { parent_id: parentId } : {}),
      ...(moving
        ? { sort_key: nextSpaceSortKey(rows, parentId, input.spaceId) }
        : {}),
      updated_at: now(),
    })
    .where("id", "=", input.spaceId)
    .where("user_id", "=", input.userId)
    .execute()
  return await assertSpaceOwner(input.spaceId, input.userId)
}

export async function deleteSpace(userId: string, spaceId: string) {
  const row = await assertSpaceOwner(spaceId, userId)
  const destination = row.parent_id
  await db.transaction().execute(async (trx) => {
    const rows = await listSpaceRows(userId, trx)
    const children = rows
      .filter((space) => space.parent_id === spaceId)
      .sort(siblingSort)
    let maxKey = rows
      .filter(
        (space) => space.parent_id === destination && space.id !== spaceId
      )
      .reduce((max, space) => Math.max(max, space.sort_key), 0)
    const timestamp = now()
    for (const child of children) {
      maxKey = sortKeyAfter(maxKey || null)
      await trx
        .updateTable("spaces")
        .set({
          parent_id: destination,
          sort_key: maxKey,
          updated_at: timestamp,
        })
        .where("id", "=", child.id)
        .where("user_id", "=", userId)
        .execute()
    }
    await trx
      .updateTable("chats")
      .set({ space_id: destination, updated_at: timestamp })
      .where("space_id", "=", spaceId)
      .where("user_id", "=", userId)
      .execute()
    await trx
      .deleteFrom("spaces")
      .where("id", "=", spaceId)
      .where("user_id", "=", userId)
      .execute()
  })
  return { ok: true as const, parentId: destination }
}

export async function setChatSpace(
  userId: string,
  chatId: string,
  spaceId: string | null
) {
  await assertChatOwner(chatId, userId)
  if (spaceId) await assertSpaceOwner(spaceId, userId)
  await db
    .updateTable("chats")
    .set({ space_id: spaceId, updated_at: now() })
    .where("id", "=", chatId)
    .where("user_id", "=", userId)
    .execute()
  return { ok: true as const }
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
    builtInTools: parseBuiltInToolsJson(prefs.builtin_tools_json),
    titleModelConfig: await getTitleModelConfig(),
  }
}

function preferenceInsertValues(
  prefs: Backup["userPreferences"][number],
  userId: string
) {
  return {
    user_id: userId,
    light_theme_id: prefs.light_theme_id,
    dark_theme_id: prefs.dark_theme_id,
    default_prompt_stack_id: prefs.default_prompt_stack_id,
    theme_mode: prefs.theme_mode,
    builtin_tools_json: prefs.builtin_tools_json,
    created_at: prefs.created_at,
    updated_at: prefs.updated_at,
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

  for (const space of orderSpacesForInsert(backup.spaces)) {
    await trx
      .insertInto("spaces")
      .values({
        id: space.id,
        user_id: userId,
        parent_id: space.parent_id,
        sort_key: space.sort_key,
        name: space.name,
        description: space.description,
        metadata_json: space.metadata_json,
        settings_json: spaceSettingsToJson(
          parseSpaceSettings(space.settings_json)
        ),
        created_at: space.created_at,
        updated_at: space.updated_at,
      })
      .execute()
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
        view_state_json: chat.view_state_json,
        prompt_stack_id: chat.prompt_stack_id ?? null,
        variables_json: chat.variables_json ?? "{}",
        space_id: chat.space_id ?? null,
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
        config_json: provider.config_json,
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
  unique(
    backup.spaces.map((space) => space.id),
    "space"
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
  const spacesByBackupId = new Map(
    backup.spaces.map((space) => [space.id, space])
  )
  for (const space of backup.spaces) {
    if (!users.has(space.user_id))
      throw new Error(`Backup space ${space.id} references an unknown user`)
    if (!space.parent_id) continue
    const parent = spacesByBackupId.get(space.parent_id)
    if (!parent || parent.user_id !== space.user_id)
      throw new Error(
        `Backup space ${space.id} references another user's space`
      )
  }
  orderSpacesForInsert(backup.spaces)

  for (const chat of backup.chats) {
    if (!users.has(chat.user_id))
      throw new Error(`Backup chat ${chat.id} references an unknown user`)
  }
  const chats = new Set(backup.chats.map((chat) => chat.id))
  const stacks = new Map(backup.promptStacks.map((stack) => [stack.id, stack]))
  const spaces = new Map(backup.spaces.map((space) => [space.id, space]))
  for (const chat of backup.chats) {
    if (!chat.prompt_stack_id) continue
    const stack = stacks.get(chat.prompt_stack_id)
    if (!stack || stack.user_id !== chat.user_id)
      throw new Error(
        `Backup chat ${chat.id} references another user's prompt stack`
      )
  }
  for (const chat of backup.chats) {
    if (!chat.space_id) continue
    const space = spaces.get(chat.space_id)
    if (!space || space.user_id !== chat.user_id)
      throw new Error(`Backup chat ${chat.id} references another user's space`)
  }
  for (const node of backup.nodes) {
    if (!chats.has(node.chat_id))
      throw new Error(`Backup node ${node.id} references an unknown chat`)
  }
  const nodes = new Set(backup.nodes.map((node) => node.id))
  const nodeChatIds = new Map(
    backup.nodes.map((node) => [node.id, node.chat_id])
  )
  for (const chat of backup.chats) {
    const state = parseChatViewState(chat.view_state_json)
    if (state.camera && nodeChatIds.get(state.camera.anchorNodeId) !== chat.id)
      throw new Error(
        "Backup chat view references a node outside its conversation"
      )
  }
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
        sort_key: node.sort_key,
        revision: node.revision,
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
    spaces: backup.spaces
      .filter((space) => space.user_id === sourceOwner.id)
      .map((space) => ({ ...space, user_id: ownerId })),
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
      .values(preferenceInsertValues(ownerPrefs, ownerId))
      .onConflict((oc) =>
        oc.column("user_id").doUpdateSet({
          light_theme_id: ownerPrefs.light_theme_id,
          dark_theme_id: ownerPrefs.dark_theme_id,
          default_prompt_stack_id: ownerPrefs.default_prompt_stack_id,
          theme_mode: ownerPrefs.theme_mode,
          builtin_tools_json: ownerPrefs.builtin_tools_json,
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
      for (const space of orderSpacesForInsert(
        backup.spaces.filter((space) => space.user_id === sourceUser.id)
      ))
        await trx
          .insertInto("spaces")
          .values({
            id: space.id,
            user_id: sourceUser.id,
            parent_id: space.parent_id,
            sort_key: space.sort_key,
            name: space.name,
            description: space.description,
            metadata_json: space.metadata_json,
            settings_json: spaceSettingsToJson(
              parseSpaceSettings(space.settings_json)
            ),
            created_at: space.created_at,
            updated_at: space.updated_at,
          })
          .execute()
      const prefs = backup.userPreferences.find(
        (prefs) => prefs.user_id === sourceUser.id
      )
      if (prefs)
        await trx
          .insertInto("user_preferences")
          .values(preferenceInsertValues(prefs, sourceUser.id))
          .execute()
      for (const chat of userChats) {
        await trx
          .insertInto("chats")
          .values({
            id: chat.id,
            user_id: sourceUser.id,
            title: chat.title,
            selected_root_node_id: chat.selected_root_node_id,
            model_config_json: chat.model_config_json,
            view_state_json: chat.view_state_json,
            prompt_stack_id: chat.prompt_stack_id ?? null,
            variables_json: chat.variables_json ?? "{}",
            space_id: chat.space_id ?? null,
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
    .selectAll()
    .execute()
  const providerProfiles = providers.map(({ config_json, ...provider }) => ({
    ...provider,
    config_json: JSON.stringify(
      providerConfigForStorage(providerConfigFromJson(config_json))
    ),
  }))
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
    spaces: await db.selectFrom("spaces").selectAll().execute(),
    themes: normalizedThemes,
    chats,
    nodes,
    attachments,
    messageAttachments,
    providerProfiles,
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
