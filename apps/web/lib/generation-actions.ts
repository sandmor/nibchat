import "server-only"
import { createHash } from "node:crypto"
import { sql } from "kysely"
import type { Kysely, Transaction } from "kysely"
import { db } from "@/lib/db"
import { now } from "@/lib/domain"
import type { DB, MessageStatus } from "@/lib/types"

type Database = Kysely<DB> | Transaction<DB>
export const GENERATION_ACTION_GRACE_MS = 15 * 60_000
const CLEANUP_BATCH_SIZE = 100
const CLEANUP_INTERVAL_MS = 60_000
let lastCleanupAt = 0

export function generationActionRequestHash(value: unknown) {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical)
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, canonical(item)])
      )
    return input
  }
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")
}

export type GenerationActionHandle = {
  actionId: string
  chatId: string
  userNodeId: string | null
  selectedNodeId: string | null
  generations: Array<{
    generationId: string
    assistantNodeId: string
    parentNodeId: string | null
  }>
}

/** Persist with the node writes so a lost POST response cannot create duplicates. */
export async function recordGenerationAction(
  database: Database,
  input: {
    actionId: string
    userId: string
    chatId: string
    intent: string
    requestHash: string
    userNodeId: string | null
    selectedNodeId: string | null
    generations: GenerationActionHandle["generations"]
  }
) {
  await database
    .insertInto("generation_actions")
    .values({
      id: input.actionId,
      user_id: input.userId,
      chat_id: input.chatId,
      intent: input.intent,
      request_hash: input.requestHash,
      user_node_id: input.userNodeId,
      selected_node_id: input.selectedNodeId,
      created_at: now(),
      completed_at: null,
    })
    .execute()
  await database
    .insertInto("generation_action_items")
    .values(
      input.generations.map((item, position) => ({
        action_id: input.actionId,
        position,
        generation_id: item.generationId,
        assistant_node_id: item.assistantNodeId,
        parent_node_id: item.parentNodeId,
      }))
    )
    .execute()
}

/** Replies remain in the tree; the last generation starts a short receipt grace period. */
export async function completeGenerationActionForRun(generationId: string) {
  const item = await db
    .selectFrom("generation_action_items")
    .select("action_id")
    .where("generation_id", "=", generationId)
    .executeTakeFirst()
  if (!item) return
  await db
    .updateTable("generation_actions")
    .set({ completed_at: now() })
    .where("id", "=", item.action_id)
    .where("completed_at", "is", null)
    .where(
      sql<boolean>`not exists (
        select 1 from generation_action_items as item
        join generation_runs as run on run.id = item.generation_id
        where item.action_id = generation_actions.id
      )`
    )
    .execute()
}

/** Opportunistic bounded cleanup works in both stateful and stateless runtimes. */
export async function pruneGenerationActions(at = new Date()) {
  if (
    at.getTime() >= lastCleanupAt &&
    at.getTime() - lastCleanupAt < CLEANUP_INTERVAL_MS
  )
    return
  lastCleanupAt = at.getTime()
  const ready = await db
    .selectFrom("generation_actions")
    .select("id")
    .where("completed_at", "is", null)
    .where(
      sql<boolean>`not exists (
        select 1 from generation_action_items as item
        join generation_runs as run on run.id = item.generation_id
        where item.action_id = generation_actions.id
      )`
    )
    .orderBy("created_at")
    .limit(CLEANUP_BATCH_SIZE)
    .execute()
  if (ready.length)
    await db
      .updateTable("generation_actions")
      .set({ completed_at: at.toISOString() })
      .where(
        "id",
        "in",
        ready.map((action) => action.id)
      )
      .where("completed_at", "is", null)
      .execute()
  const expired = await db
    .selectFrom("generation_actions")
    .select("id")
    .where(
      "completed_at",
      "<=",
      new Date(at.getTime() - GENERATION_ACTION_GRACE_MS).toISOString()
    )
    .orderBy("completed_at")
    .limit(CLEANUP_BATCH_SIZE)
    .execute()
  if (expired.length)
    await db
      .deleteFrom("generation_actions")
      .where(
        "id",
        "in",
        expired.map((action) => action.id)
      )
      .where(
        sql<boolean>`not exists (
          select 1 from generation_action_items as item
          join generation_runs as run on run.id = item.generation_id
          where item.action_id = generation_actions.id
        )`
      )
      .execute()
  // A full page means there is more work. Let the next request continue it.
  if (
    ready.length === CLEANUP_BATCH_SIZE ||
    expired.length === CLEANUP_BATCH_SIZE
  )
    lastCleanupAt = 0
}

export async function getGenerationAction(actionId: string, userId: string) {
  const action = await db
    .selectFrom("generation_actions")
    .selectAll()
    .where("id", "=", actionId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!action) return null
  const items = await db
    .selectFrom("generation_action_items")
    .leftJoin(
      "message_nodes",
      "message_nodes.id",
      "generation_action_items.assistant_node_id"
    )
    .select([
      "generation_action_items.generation_id",
      "generation_action_items.assistant_node_id",
      "generation_action_items.parent_node_id",
      "message_nodes.status",
    ])
    .where("generation_action_items.action_id", "=", actionId)
    .orderBy("generation_action_items.position")
    .execute()
  return {
    actionId: action.id,
    chatId: action.chat_id,
    intent: action.intent,
    requestHash: action.request_hash,
    userNodeId: action.user_node_id,
    selectedNodeId: action.selected_node_id,
    generations: items.map((item) => ({
      generationId: item.generation_id,
      assistantNodeId: item.assistant_node_id,
      parentNodeId: item.parent_node_id,
      status: (item.status as MessageStatus | null) ?? "deleted",
    })),
  }
}

export function actionMatchesRequest(
  action: NonNullable<Awaited<ReturnType<typeof getGenerationAction>>>,
  input: { chatId: string; requestHash: string }
) {
  return (
    action.chatId === input.chatId && action.requestHash === input.requestHash
  )
}
