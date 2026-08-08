import type { QueryClient } from "@tanstack/react-query"
import type { NodeRow } from "@/lib/types"
import { resolveActivePath } from "@/lib/domain"
import type { WorkspaceData } from "@/lib/workspace-cache"

export type StreamRequestBody =
  | {
      chatId: string
      intent: "continue"
      parentNodeId?: string | null
      content: string
    }
  | {
      chatId: string
      intent: "regenerate"
      assistantNodeId: string
    }
  | {
      chatId: string
      intent: "generate"
      parentNodeId: string
    }

export function viewPathFromCache(
  queryClient: QueryClient,
  getQueryKey: (input: { chatId: string }) => readonly unknown[],
  chatId: string
): NodeRow[] {
  const cached = queryClient.getQueryData(getQueryKey({ chatId })) as
    | WorkspaceData
    | undefined
  if (!cached?.chat) return []
  return resolveActivePath(cached.nodes, cached.chat.selected_root_node_id)
}

/**
 * Soft-follow only when still viewing this chat and the view tip still
 * matches the generation start anchor (user has not navigated away).
 */
export function shouldSoftFollow(
  body: StreamRequestBody,
  path: NodeRow[],
  selectedChatId: string | null
): boolean {
  if (selectedChatId !== body.chatId) return false
  const tipId = path.at(-1)?.id ?? null
  if (body.intent === "continue") {
    return tipId === (body.parentNodeId ?? null)
  }
  if (body.intent === "generate") {
    return tipId === body.parentNodeId
  }
  // regenerate: original assistant still visible on the active path
  return path.some((node) => node.id === body.assistantNodeId)
}

export async function readStreamEvents(
  body: ReadableStream<Uint8Array>,
  handlers: {
    onText: (delta: string) => void
    onReasoning: (delta: string) => void
  }
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let carry = ""
  while (true) {
    const part = await reader.read()
    if (part.done) break
    carry += decoder.decode(part.value, { stream: true })
    const lines = carry.split("\n")
    carry = lines.pop() ?? ""
    for (const line of lines)
      if (line.startsWith("data: ")) {
        const raw = line.slice(6).trim()
        if (!raw || raw === "[DONE]") continue
        try {
          const event = JSON.parse(raw) as {
            type?: string
            delta?: string
            errorText?: string
          }
          if (event.type === "text-delta" && event.delta)
            handlers.onText(event.delta)
          if (event.type === "reasoning-delta" && event.delta)
            handlers.onReasoning(event.delta)
          if (event.type === "error")
            throw new Error(
              event.errorText || "An error occurred while generating."
            )
        } catch (eventError) {
          if (eventError instanceof SyntaxError) continue
          throw eventError
        }
      }
  }
}
