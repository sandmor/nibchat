import "server-only"
import { db } from "@/lib/db"

/** Conversation depth is zero; its direct helpers are depth one. */
export async function taskDepth(userId: string, chatId: string) {
  let depth = 0
  let current: string | null = chatId
  const seen = new Set<string>()
  while (current) {
    if (seen.has(current)) throw new Error("Invalid helper ancestry")
    seen.add(current)
    const chat: { kind: string; parent_chat_id: string | null } | undefined =
      await db
        .selectFrom("chats")
        .select(["kind", "parent_chat_id"])
        .where("id", "=", current)
        .where("user_id", "=", userId)
        .executeTakeFirst()
    if (!chat) throw new Error("Chat not found")
    if (chat.kind === "agent_run") depth++
    current = chat.parent_chat_id
  }
  return depth
}
