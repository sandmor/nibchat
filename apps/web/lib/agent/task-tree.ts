import "server-only"
import { db } from "@/lib/db"
import { parseJson } from "@/lib/domain"

type TaskTreeItem = {
  id: string
  parentId: string | null
  title: string
  helper: string
  depth: number
  status: "queued" | "running" | "awaiting_input" | "completed" | "stopped" | "error"
  tokens: number
}

export async function listTaskTree(userId: string, rootId: string) {
  const root = await db
    .selectFrom("chats")
    .select(["id", "kind"])
    .where("id", "=", rootId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!root || root.kind !== "agent_run") throw new Error("Helper not found")

  const queue = [{ id: rootId, depth: 0 }]
  const result: TaskTreeItem[] = []
  const seen = new Set<string>()
  while (queue.length) {
    const current = queue.shift()!
    if (seen.has(current.id)) continue
    seen.add(current.id)
    const chat = await db
      .selectFrom("chats")
      .select(["id", "parent_chat_id", "title", "agent_config_json"])
      .where("id", "=", current.id)
      .where("user_id", "=", userId)
      .executeTakeFirst()
    if (!chat) continue
    const [runs, assistants, children] = await Promise.all([
      db
        .selectFrom("generation_runs")
        .select("id")
        .where("chat_id", "=", chat.id)
        .execute(),
      db
        .selectFrom("message_nodes")
        .select(["status", "metadata_json"])
        .where("chat_id", "=", chat.id)
        .where("role", "=", "assistant")
        .orderBy("created_at", "desc")
        .execute(),
      db
        .selectFrom("chats")
        .select("id")
        .where("parent_chat_id", "=", chat.id)
        .where("user_id", "=", userId)
        .orderBy("created_at")
        .execute(),
    ])
    const latest = assistants[0]
    const status: TaskTreeItem["status"] = runs.length
      ? "running"
      : latest?.status === "awaiting_input"
        ? "awaiting_input"
        : latest?.status === "complete"
          ? "completed"
          : latest?.status === "stopped"
            ? "stopped"
            : latest?.status === "error"
              ? "error"
              : "queued"
    const snapshot = parseJson<{ name?: string }>(chat.agent_config_json ?? "{}", {})
    const tokens = assistants.reduce((total, assistant) => {
      const meta = parseJson<{ usage?: { totalTokens?: number } }>(
        assistant.metadata_json,
        {}
      )
      return total + (meta.usage?.totalTokens ?? 0)
    }, 0)
    result.push({
      id: chat.id,
      parentId: chat.parent_chat_id,
      title: chat.title ?? "Task",
      helper: snapshot.name ?? "Helper",
      depth: current.depth,
      status,
      tokens,
    })
    queue.push(...children.map((child) => ({ id: child.id, depth: current.depth + 1 })))
  }
  return result
}
