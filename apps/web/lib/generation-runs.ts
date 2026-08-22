import "server-only"
import type { Kysely, Transaction } from "kysely"
import { db } from "@/lib/db"
import { now } from "@/lib/domain"
import type { DB } from "@/lib/types"

type Database = Kysely<DB> | Transaction<DB>

export async function insertGenerationRun(
  database: Database,
  input: { id: string; nodeId: string; chatId: string }
) {
  await database
    .insertInto("generation_runs")
    .values({
      id: input.id,
      node_id: input.nodeId,
      chat_id: input.chatId,
      started_at: now(),
      state: "starting",
    })
    .execute()
}

export async function getGenerationRun(generationId: string) {
  return db
    .selectFrom("generation_runs")
    .selectAll()
    .where("id", "=", generationId)
    .executeTakeFirst()
}

export async function listGenerationRuns(chatId: string) {
  return db
    .selectFrom("generation_runs")
    .selectAll()
    .where("chat_id", "=", chatId)
    .orderBy("started_at")
    .execute()
}

export async function requestGenerationCancellation(generationId: string) {
  await db
    .updateTable("generation_runs")
    .set({ state: "cancel_requested" })
    .where("id", "=", generationId)
    .where("state", "in", ["starting", "active"])
    .execute()
}

export async function activateGenerationRun(generationId: string) {
  const result = await db
    .updateTable("generation_runs")
    .set({ state: "active" })
    .where("id", "=", generationId)
    .where("state", "=", "starting")
    .executeTakeFirst()
  return Number(result.numUpdatedRows ?? 0) > 0
}

export async function claimGenerationRecovery(generationId: string) {
  const result = await db
    .updateTable("generation_runs")
    .set({ state: "recovering" })
    .where("id", "=", generationId)
    .where("state", "in", [
      "starting",
      "active",
      "cancel_requested",
      "recovering",
    ])
    .executeTakeFirst()
  return Number(result.numUpdatedRows ?? 0) > 0
}

export async function restoreGenerationRunState(
  generationId: string,
  state: "starting" | "active" | "cancel_requested"
) {
  await db
    .updateTable("generation_runs")
    .set({ state })
    .where("id", "=", generationId)
    .where("state", "=", "recovering")
    .execute()
}

export async function removeGenerationRun(
  database: Database,
  generationId: string
) {
  await database
    .deleteFrom("generation_runs")
    .where("id", "=", generationId)
    .execute()
}
