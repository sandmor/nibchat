import {
  resolveStreamTerminalOutcome,
  searchTextFromParts,
  terminalStatusForParts,
} from "@/lib/agent/parts"
import type { ChatRow, NodeRow, Parts } from "@/lib/types"
import { chatViewStateToJson, type ChatViewState } from "@/lib/chat-view-state"

export type WorkspaceData = {
  chats: ChatRow[]
  chat: ChatRow | null
  nodes: NodeRow[]
  activeGenerations: Array<{
    generationId: string
    nodeId: string
    chatId: string
    parentNodeId: string | null
    startedAt: string
  }>
}

/** Query key payload for workspace.get — null chatId + draft clears auto-select. */
export function workspaceInput(chatId: string | null | undefined) {
  if (chatId === null) return { draft: true as const }
  if (chatId) return { chatId }
  return undefined
}

/** Optimistic patch for chat title in the cached workspace payload. */
export function patchChatTitle(
  data: WorkspaceData | undefined,
  chatId: string,
  title: string
): WorkspaceData | undefined {
  if (!data) return data
  return {
    ...data,
    chats: data.chats.map((chat) =>
      chat.id === chatId ? { ...chat, title } : chat
    ),
    chat: data.chat?.id === chatId ? { ...data.chat, title } : data.chat,
  }
}

/** Optimistic durable presentation state; it must not affect list ordering. */
export function patchChatViewState(
  data: WorkspaceData | undefined,
  chatId: string,
  state: ChatViewState
): WorkspaceData | undefined {
  if (!data) return data
  const patch = (chat: ChatRow) =>
    chat.id === chatId
      ? { ...chat, view_state_json: chatViewStateToJson(state) }
      : chat
  return {
    ...data,
    chats: data.chats.map(patch),
    chat: data.chat ? patch(data.chat) : null,
  }
}

/** Optimistic remove of a chat from the list. */
export function omitChat(
  data: WorkspaceData | undefined,
  chatId: string
): WorkspaceData | undefined {
  if (!data) return data
  const chats = data.chats.filter((chat) => chat.id !== chatId)
  const wasActive = data.chat?.id === chatId
  return {
    chats,
    chat: wasActive ? null : data.chat,
    nodes: wasActive ? [] : data.nodes,
    activeGenerations: wasActive ? [] : data.activeGenerations,
  }
}

/** Optimistic select-child / select-root for branch navigation. */
export function patchSelection(
  data: WorkspaceData | undefined,
  patch:
    | { kind: "child"; nodeId: string; childId: string | null }
    | { kind: "root"; nodeId: string }
): WorkspaceData | undefined {
  if (!data) return data
  if (patch.kind === "root") {
    return {
      ...data,
      chat: data.chat
        ? { ...data.chat, selected_root_node_id: patch.nodeId }
        : data.chat,
    }
  }
  return {
    ...data,
    nodes: data.nodes.map((node) =>
      node.id === patch.nodeId
        ? { ...node, selected_child_id: patch.childId }
        : node
    ),
  }
}

/** Optimistic context-exclusion state for a single durable message node. */
export function patchContextExcluded(
  data: WorkspaceData | undefined,
  nodeId: string,
  excluded: boolean
): WorkspaceData | undefined {
  if (!data) return data
  return {
    ...data,
    nodes: data.nodes.map((node) =>
      node.id === nodeId ? { ...node, excluded_from_context: excluded } : node
    ),
  }
}

/**
 * Apply a live stream buffer onto the durable node so dropping the overlay
 * does not flash the empty streaming shell ("Thinking…").
 * No-op when the node is already terminal — leftover buffers must not clobber it.
 */
export function patchNodeFromStreamParts(
  data: WorkspaceData | undefined,
  nodeId: string,
  parts: Parts,
  outcome: "complete" | "awaiting_input" | "aborted" | "error",
  options?: { preserveActiveGenerations?: boolean }
): WorkspaceData | undefined {
  if (!data) return data
  const node = data.nodes.find((row) => row.id === nodeId)
  if (!node || node.status !== "streaming") return data
  const resolved = resolveStreamTerminalOutcome(outcome, parts)
  const status = terminalStatusForParts(resolved, parts)
  return {
    ...data,
    nodes: data.nodes.map((row) =>
      row.id === nodeId
        ? {
            ...row,
            parts_json: JSON.stringify(parts),
            search_text: searchTextFromParts(parts),
            status,
            updated_at: new Date().toISOString(),
          }
        : row
    ),
    activeGenerations: options?.preserveActiveGenerations
      ? data.activeGenerations
      : data.activeGenerations.filter((run) => run.nodeId !== nodeId),
  }
}

/**
 * Copy buffer parts onto a still-streaming node without claiming a terminal
 * status. Discovery can keep following until the server drops the run.
 */
export function hydrateStreamingNodeParts(
  data: WorkspaceData | undefined,
  nodeId: string,
  parts: Parts
): WorkspaceData | undefined {
  if (!data) return data
  const node = data.nodes.find((row) => row.id === nodeId)
  if (!node || node.status !== "streaming") return data
  return {
    ...data,
    nodes: data.nodes.map((row) =>
      row.id === nodeId
        ? {
            ...row,
            parts_json: JSON.stringify(parts),
            search_text: searchTextFromParts(parts),
            updated_at: new Date().toISOString(),
          }
        : row
    ),
  }
}
