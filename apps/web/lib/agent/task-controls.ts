import "server-only"
import { abortGenerations } from "@/lib/active-generations"
import { db } from "@/lib/db"
import { generationStreamStore } from "@/lib/generation-streams/default-port"
import { requestGenerationCancellation } from "@/lib/generation-runs"
import { MAX_PROMPT_CHARS } from "@/lib/limits"

export async function queueAgentMessage(
  userId: string,
  chatId: string,
  content: string
) {
  const text = content.trim()
  if (!text || text.length > MAX_PROMPT_CHARS)
    throw new Error("Message is empty or too long")
  return db.transaction().execute(async (trx) => {
    const chat = await trx
      .selectFrom("chats")
      .select(["id", "kind"])
      .where("id", "=", chatId)
      .where("user_id", "=", userId)
      .executeTakeFirst()
    if (!chat || chat.kind !== "agent_run") throw new Error("Helper not found")
    const claim = await trx
      .updateTable("helper_task_invocations")
      .set({ result_json: null })
      .where("chat_id", "=", chatId)
      .where("result_json", "is", null)
      .executeTakeFirst()
    if (Number(claim.numUpdatedRows ?? 0) < 1)
      throw new Error("This helper has finished its current task")
    await trx
      .insertInto("helper_task_messages")
      .values({
        id: crypto.randomUUID(),
        chat_id: chatId,
        user_id: userId,
        content: text,
        created_at: new Date().toISOString(),
        claimed_at: null,
        delivered_at: null,
      })
      .execute()
    return { queued: true }
  })
}

export async function stopAgentRun(userId: string, chatId: string) {
  const root = await db
    .selectFrom("chats")
    .select(["id", "kind"])
    .where("id", "=", chatId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!root || root.kind !== "agent_run") throw new Error("Helper not found")

  const chatIds = [chatId]
  for (let index = 0; index < chatIds.length; index++) {
    const children = await db
      .selectFrom("chats")
      .select("id")
      .where("parent_chat_id", "=", chatIds[index]!)
      .where("user_id", "=", userId)
      .execute()
    for (const child of children)
      if (!chatIds.includes(child.id)) chatIds.push(child.id)
  }

  const runs = await db
    .selectFrom("generation_runs")
    .select(["id", "node_id"])
    .where("chat_id", "in", chatIds)
    .execute()
  await Promise.all(
    runs.map(async (run) => {
      await requestGenerationCancellation(run.id)
      await generationStreamStore.requestCancel(run.id).catch(() => {})
    })
  )
  abortGenerations(runs.map((run) => run.node_id))
  await db
    .updateTable("message_nodes")
    .set({ status: "stopped", updated_at: new Date().toISOString() })
    .where("chat_id", "in", chatIds)
    .where("role", "=", "assistant")
    .where("status", "=", "awaiting_input")
    .execute()
  return { stopped: chatIds.length }
}
