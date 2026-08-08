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
 * Soft-follow only when the user is still viewing the chat being streamed.
 * Prefer URL (stable across client navigation) over React selection state,
 * because MPA navigation unmounts ChatView without updating the old instance.
 *
 * @param pathname — defaults to `window.location.pathname` in the browser
 */
export function isViewingChat(
  chatId: string,
  selectedChatId: string | null,
  pathname: string | null = typeof window !== "undefined"
    ? window.location.pathname
    : null
): boolean {
  if (pathname != null) {
    if (pathname === "/chat/new") {
      // Draft route after ensureChatId: selection ref already points at the new id.
      return selectedChatId === chatId
    }
    if (pathname.startsWith("/chat/")) {
      const routeId = pathname.slice("/chat/".length).split(/[/?#]/)[0]
      return routeId === chatId
    }
    // Settings, login, or any other path — fail closed (do not use selection alone).
    return false
  }
  return selectedChatId === chatId
}

/**
 * Soft-follow only when still viewing this chat and the view tip still
 * matches the generation start anchor (user has not navigated away).
 */
export function shouldSoftFollow(
  body: StreamRequestBody,
  path: NodeRow[],
  selectedChatId: string | null,
  pathname?: string | null
): boolean {
  if (!isViewingChat(body.chatId, selectedChatId, pathname)) return false
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

/**
 * Where a live stream should appear relative to the active selection path.
 */
export function streamPlacement(
  stream: { nodeId: string; parentNodeId: string | null },
  path: NodeRow[],
  nodes: NodeRow[]
): "inline" | "after-tip" | "hidden" {
  if (path.some((node) => node.id === stream.nodeId)) return "inline"

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const row = byId.get(stream.nodeId)
  const parentId = row?.parent_id ?? stream.parentNodeId
  const tip = path.at(-1)

  if (!tip) {
    // Empty view: only a root-level generation can show.
    return parentId == null ? "after-tip" : "hidden"
  }

  if (parentId !== tip.id) return "hidden"
  // Tip has another selected child → path should already include that child,
  // not this sibling stream.
  if (tip.selected_child_id != null && tip.selected_child_id !== stream.nodeId)
    return "hidden"
  return "after-tip"
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
