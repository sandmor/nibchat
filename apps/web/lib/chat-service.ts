import "server-only"
import { sql } from "kysely"
import { db } from "@/lib/db"
import { id, now, parseJson, subtreeNodeIds, textFromParts } from "@/lib/domain"
import { abortGenerations } from "@/lib/active-generations"
import type { MessageRole, NodeRow, Parts } from "@/lib/types"
import { defaultModelConfig, type ModelConfig } from "@/lib/providers"
import { orderNodesForInsert, parseBackup } from "@/lib/backup"
import {
  appearanceToJson,
  defaultAppearance,
  parseAppearance,
  type Appearance,
} from "@/lib/appearance"

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
      "message_nodes.status",
      "message_nodes.created_at",
      "message_nodes.updated_at",
    ])
    .where("message_nodes.id", "=", nodeId)
    .where("chats.user_id", "=", userId)
    .executeTakeFirst()
  if (!row) throw new Error("Node not found")
  return row as NodeRow
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
  return { chats, chat: selected ?? null, nodes }
}

export async function createChat(
  userId: string,
  title = "New conversation",
  config?: ModelConfig
) {
  const resolved =
    config && (config.providerId || config.model)
      ? config
      : await defaultModelConfig(userId)
  const timestamp = now()
  const chat = {
    id: id(),
    user_id: userId,
    title,
    selected_root_node_id: null,
    model_config_json: JSON.stringify(resolved),
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
}

export async function insertNode(input: {
  chatId: string
  parentId: string | null
  role: MessageRole
  parts: Parts
  metadata?: Record<string, unknown>
  status?: "complete" | "streaming" | "stopped" | "error"
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
    search_text: textFromParts(input.parts),
    metadata_json: JSON.stringify(input.metadata ?? {}),
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
    search_text: textFromParts(input.parts),
    metadata_json: JSON.stringify(input.metadata ?? {}),
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
  chatId: string
  parentId: string | null
  content: string
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
  const user = newNode(
    {
      chatId: input.chatId,
      parentId: input.parentId,
      role: "user",
      parts: [{ type: "text", text: input.content }],
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
    await trx.insertInto("message_nodes").values(assistant).execute()
  })
  return { user, assistant }
}

export async function updateNode(
  nodeId: string,
  parts: Parts,
  status?: "complete" | "stopped" | "error"
) {
  await db
    .updateTable("message_nodes")
    .set({
      parts_json: JSON.stringify(parts),
      search_text: textFromParts(parts),
      ...(status ? { status } : {}),
      updated_at: now(),
    })
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

export async function forkEdit(userId: string, nodeId: string, parts: Parts) {
  const original = await assertNodeOwner(nodeId, userId)
  return insertNode({
    chatId: original.chat_id,
    parentId: original.parent_id,
    role: original.role,
    parts,
    metadata: {
      ...parseJson<Record<string, unknown>>(original.metadata_json, {}),
      provenance: "owner-edited",
      editedFrom: original.id,
    },
  })
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

export type StreamFinalizeOutcome = "complete" | "aborted" | "error"

export type StreamFinalizeResult =
  | "complete"
  | "stopped"
  | "deleted"
  | "error"
  | "missing"
  | "superseded"

export type StreamFinalizeInput = {
  nodeId: string
  outcome: StreamFinalizeOutcome
  text?: string
  reasoning?: string
  usage?: unknown
  finishReason?: string
  error?: string
  config?: ModelConfig
  previousMetadata?: Record<string, unknown>
}

/**
 * Update parts/status only while the node is still `streaming`.
 * Returns false if the row is missing or already finalized (or cascade-deleted).
 */
async function updateStreamingNode(
  nodeId: string,
  parts: Parts,
  status: "complete" | "stopped" | "error"
): Promise<boolean> {
  const result = await db
    .updateTable("message_nodes")
    .set({
      parts_json: JSON.stringify(parts),
      search_text: textFromParts(parts),
      status,
      updated_at: now(),
    })
    .where("id", "=", nodeId)
    .where("status", "=", "streaming")
    .executeTakeFirst()
  return Number(result.numUpdatedRows ?? 0) > 0
}

function partsFromPartial(text: string, reasoning: string): Parts {
  return [
    ...(reasoning ? [{ type: "reasoning" as const, text: reasoning }] : []),
    ...(text ? [{ type: "text" as const, text }] : []),
  ]
}

/**
 * Single write path for stream terminal outcomes (complete / aborted / error).
 * Idempotent: only mutates rows that are still `status = 'streaming'`.
 * Returns "missing" if cascade-deleted, "superseded" if already finalized.
 */
export async function finalizeStreamingAssistant(
  input: StreamFinalizeInput
): Promise<StreamFinalizeResult> {
  const row = await db
    .selectFrom("message_nodes")
    .select(["id", "chat_id", "status", "metadata_json"])
    .where("id", "=", input.nodeId)
    .executeTakeFirst()
  if (!row) return "missing"
  if (row.status !== "streaming") return "superseded"

  const text = input.text?.trim() ?? ""
  const reasoning = input.reasoning?.trim() ?? ""
  const previous = {
    ...parseJson<Record<string, unknown>>(row.metadata_json, {}),
    ...(input.previousMetadata ?? {}),
  }
  const config = input.config

  if (input.outcome === "aborted") {
    if (!text && !reasoning) {
      return deleteStreamingShell(input.nodeId)
    }
    const updated = await updateStreamingNode(
      input.nodeId,
      partsFromPartial(text, reasoning),
      "stopped"
    )
    return updated ? "stopped" : "superseded"
  }

  if (input.outcome === "error") {
    const updated = await updateStreamingNode(
      input.nodeId,
      partsFromPartial(text, reasoning),
      "error"
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

  // complete — keep full provider text (including empty); trim only reasoning.
  const completeReasoning = (input.reasoning ?? "").trim()
  const completeParts: Parts = [
    ...(completeReasoning
      ? [{ type: "reasoning" as const, text: completeReasoning }]
      : []),
    { type: "text" as const, text: input.text ?? "" },
  ]
  const updated = await updateStreamingNode(
    input.nodeId,
    completeParts,
    "complete"
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
      "[vero] deleteStreamingShell: assistant has children; skipping",
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
  partial: { text?: string; reasoning?: string }
): Promise<"stopped" | "deleted" | "missing" | "superseded"> {
  const result = await finalizeStreamingAssistant({
    nodeId,
    outcome: "aborted",
    text: partial.text,
    reasoning: partial.reasoning,
  })
  if (result === "complete" || result === "error") return "superseded"
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

export async function createProvider(
  userId: string,
  profile: {
    name: string
    kind: "openai" | "anthropic" | "openai-compatible"
    baseUrl?: string
    apiKey?: string
    apiKeyEnv?: string
    models: string[]
  }
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
    models_json: JSON.stringify(profile.models),
    created_at: timestamp,
    updated_at: timestamp,
  }
  await db.insertInto("provider_profiles").values(row).execute()
  return { id: row.id }
}

export async function updateProvider(
  userId: string,
  providerId: string,
  profile: {
    name: string
    kind: "openai" | "anthropic" | "openai-compatible"
    baseUrl?: string
    apiKey?: string
    apiKeyEnv?: string
    models: string[]
  }
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
      models_json: JSON.stringify(profile.models),
      updated_at: now(),
    })
    .where("id", "=", providerId)
    .where("user_id", "=", userId)
    .execute()
}

export async function deleteProvider(userId: string, providerId: string) {
  await db
    .deleteFrom("provider_profiles")
    .where("id", "=", providerId)
    .where("user_id", "=", userId)
    .execute()
}

export async function setAppearance(input: Appearance) {
  const config = parseAppearance(input)
  await db
    .updateTable("instance")
    .set({ appearance_json: appearanceToJson(config, false) })
    .where("id", "=", 1)
    .execute()
  return config
}

export async function getInstanceSettings() {
  const row = await db
    .selectFrom("instance")
    .select(["system_prompt", "appearance_json"])
    .where("id", "=", 1)
    .executeTakeFirstOrThrow()
  return {
    system_prompt: row.system_prompt,
    appearance: parseAppearance(
      row.appearance_json ? JSON.parse(row.appearance_json) : {}
    ),
  }
}

export async function updateSystemPrompt(systemPrompt: string) {
  await db
    .updateTable("instance")
    .set({ system_prompt: systemPrompt })
    .where("id", "=", 1)
    .execute()
}

export async function restoreBackup(userId: string, raw: unknown) {
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

    for (const chat of backup.chats) {
      await trx
        .insertInto("chats")
        .values({
          id: chat.id,
          user_id: userId,
          title: chat.title,
          selected_root_node_id: chat.selected_root_node_id,
          model_config_json: chat.model_config_json,
          created_at: chat.created_at,
          updated_at: chat.updated_at,
        })
        .execute()
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
          status: node.status,
          created_at: node.created_at,
          updated_at: node.updated_at,
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
    let appearance = defaultAppearance()
    if (backup.instance?.appearance) {
      appearance = parseAppearance(backup.instance.appearance)
    } else if (backup.appearance) {
      appearance = parseAppearance(backup.appearance)
    }
    if (backup.instance || backup.appearance) {
      await trx
        .updateTable("instance")
        .set({
          ...(backup.instance?.system_prompt !== undefined
            ? { system_prompt: backup.instance.system_prompt }
            : {}),
          appearance_json: appearanceToJson(appearance, false),
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
  const nodes =
    chatIds.length === 0
      ? []
      : await db
          .selectFrom("message_nodes")
          .selectAll()
          .where("chat_id", "in", chatIds)
          .execute()
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
  const instance = await db
    .selectFrom("instance")
    .select(["system_prompt", "appearance_json"])
    .where("id", "=", 1)
    .executeTakeFirst()
  return {
    version: 1 as const,
    createdAt: new Date().toISOString(),
    instance: instance
      ? {
          system_prompt: instance.system_prompt,
          appearance: parseAppearance(
            instance.appearance_json ? JSON.parse(instance.appearance_json) : {}
          ),
        }
      : undefined,
    chats,
    nodes,
    providerProfiles: providers,
  }
}
