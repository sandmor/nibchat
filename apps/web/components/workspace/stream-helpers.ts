import type { QueryClient } from "@tanstack/react-query"
import type { AttachmentReference, MessageStatus, NodeRow } from "@/lib/types"
import type { GenerationPayload } from "@/lib/generation-streams/events"
import { resolveActivePath } from "@/lib/domain"
import {
  hasLiveStreamReader,
  type StreamBuffer,
  type StreamMeta,
} from "@/lib/stream-store"
import {
  patchNodeFromStreamParts,
  type WorkspaceData,
} from "@/lib/workspace-cache"

export type StreamRequestInput =
  | {
      chatId: string
      intent: "continue"
      parentNodeId?: string | null
      content: string
      attachments?: AttachmentReference[]
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
  | {
      chatId: string
      intent: "resume"
      assistantNodeId: string
      toolResults: Array<{ toolCallId: string; output: unknown }>
    }

/** Complete wire payload sent to the generation route. */
export type StreamRequestBody = StreamRequestInput & { timeZone: string }

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
 *
 * This is tree-selection soft-follow: keep the generating node on the
 * active path. It deliberately does not control viewport scroll — the
 * end-anchored transcript follows only while the reader is at the live edge.
 * Do not call scrollToEnd/scrollToIndex from soft-follow paths.
 */
export function shouldSoftFollow(
  body: StreamRequestInput,
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
  // regenerate / resume: original assistant still visible on the active path
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

export function shouldFollowGeneration(input: {
  streamId: string
  node: NodeRow | undefined
  controllers: Record<string, AbortController>
  stream: StreamMeta | undefined
}): boolean {
  if (hasLiveStreamReader(input.controllers, input.streamId)) return false
  if (input.node && input.node.status !== "streaming") return false
  return true
}

/**
 * Re-apply cancelled stream buffers onto workspace data so a refetch that still
 * lists the generation as live cannot flash the empty streaming shell.
 * Leaves `activeGenerations` intact so discovery can re-attach after leave.
 */
export function applyStoppingStreamPatches(
  data: WorkspaceData | undefined,
  streams: Record<string, StreamMeta>,
  buffers: Record<string, StreamBuffer>
): WorkspaceData | undefined {
  if (!data) return data
  let next = data
  for (const [streamId, meta] of Object.entries(streams)) {
    if (!meta.stopping) continue
    next =
      patchNodeFromStreamParts(
        next,
        meta.nodeId,
        buffers[streamId]?.parts ?? [],
        "aborted",
        { preserveActiveGenerations: true }
      ) ?? next
  }
  return next
}

export type StreamEndReason = "aborted" | "gone" | "failed"

export type StreamEndPlan = {
  keepStore: boolean
  write: "none" | "aborted" | "hydrate"
  dropOverlay: boolean
  invalidate: boolean
}

/**
 * Decide overlay vs cache writes from a reader end. The client never claims
 * complete/error; those come from workspace refetch after the run is gone.
 */
export function planStreamEnd(input: {
  reason: StreamEndReason
  stopping: boolean
  nodeStatus: MessageStatus | undefined
  hasParts: boolean
}): StreamEndPlan {
  if (input.reason === "aborted") {
    return {
      keepStore: true,
      write: "none",
      dropOverlay: false,
      invalidate: false,
    }
  }
  if (input.stopping && input.nodeStatus === "streaming") {
    return {
      keepStore: false,
      write: "aborted",
      dropOverlay: true,
      invalidate: true,
    }
  }
  if (!input.stopping && input.nodeStatus === "streaming" && input.hasParts) {
    return {
      keepStore: false,
      write: "hydrate",
      dropOverlay: true,
      invalidate: true,
    }
  }
  return {
    keepStore: false,
    write: "none",
    dropOverlay: true,
    invalidate: true,
  }
}

export type FollowGenerationResult = "aborted" | "gone"

function sleepMs(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

/**
 * Attach to a server-owned generation, resuming from `cursor`.
 * Abort returns immediately — it is not a failed attach that should back off.
 */
export async function followGenerationStream(input: {
  streamId: string
  signal: AbortSignal
  cursor: string | null
  onEvent: (event: GenerationPayload) => void
  onCursor: (cursor: string) => void
}): Promise<FollowGenerationResult> {
  let cursor = input.cursor
  let attempt = 0
  while (!input.signal.aborted) {
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
    const response = await fetch(
      `/api/chat/stream/${encodeURIComponent(input.streamId)}${suffix}`,
      { signal: input.signal }
    ).catch(() => null)
    if (input.signal.aborted) return "aborted"
    if (response?.status === 404 || response?.status === 410) return "gone"
    if (!response?.ok || !response.body) {
      await sleepMs(Math.min(5_000, 250 * 2 ** attempt++), input.signal)
      continue
    }
    attempt = 0
    try {
      await readStreamEvents(response.body, {
        onEvent: input.onEvent,
        onCursor: (next) => {
          cursor = next
          input.onCursor(next)
        },
      })
      if (input.signal.aborted) return "aborted"
      // Clean SSE end is not generation complete — re-attach until 404/410.
    } catch {
      if (input.signal.aborted) return "aborted"
    }
  }
  return "aborted"
}

export type StreamEventHandlers = {
  onEvent: (event: GenerationPayload) => void
  onCursor?: (cursor: string) => void
}

/**
 * Parse AI SDK UI message SSE events into app-level handlers.
 */
export async function readStreamEvents(
  body: ReadableStream<Uint8Array>,
  handlers: StreamEventHandlers
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let carry = ""
  let eventCursor: string | undefined
  while (true) {
    const part = await reader.read()
    if (part.done) break
    carry += decoder.decode(part.value, { stream: true })
    const lines = carry.split("\n")
    carry = lines.pop() ?? ""
    for (const line of lines)
      if (line.startsWith("id: ")) eventCursor = line.slice(4).trim()
      else if (line.startsWith("data: ")) {
        const raw = line.slice(6).trim()
        if (!raw || raw === "[DONE]") continue
        try {
          const event = JSON.parse(raw) as GenerationPayload
          if (event.type === "error")
            throw new Error(
              event.errorText || "An error occurred while generating."
            )
          handlers.onEvent(event)
          if (eventCursor) handlers.onCursor?.(eventCursor)
          eventCursor = undefined
        } catch (eventError) {
          if (eventError instanceof SyntaxError) continue
          throw eventError
        }
      }
  }
}
