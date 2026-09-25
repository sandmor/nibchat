import { textFromParts as textFromPartsImpl } from "@/lib/agent/parts"
import { siblingSort } from "@/lib/sort-key"
import type { NodeRow, Parts } from "@/lib/types"

export const id = () => crypto.randomUUID()
export const now = () => new Date().toISOString()
export const parseJson = <T>(value: string, fallback: T) => {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

/** Visible prose only (excludes reasoning and tools). */
export const textFromParts = (parts: Parts) => textFromPartsImpl(parts)

export function resolveActivePath(nodes: NodeRow[], rootId: string | null) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const children = new Map<string | null, NodeRow[]>()
  for (const node of nodes) {
    const siblings = children.get(node.parent_id) ?? []
    siblings.push(node)
    children.set(node.parent_id, siblings)
  }
  for (const siblings of children.values()) siblings.sort(siblingSort)
  let current = rootId ? byId.get(rootId) : children.get(null)?.[0]
  const path: NodeRow[] = []
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    path.push(current)
    seen.add(current.id)
    const directChildren = children.get(current.id) ?? []
    const selected = current.selected_child_id
      ? byId.get(current.selected_child_id)
      : undefined
    // A null pointer means no explicit branch preference, not “hide all
    // children”. This gives Tree-created first children a Linear continuation
    // without modifying the user's persisted branch selection.
    current =
      selected?.parent_id === path.at(-1)?.id ? selected : directChildren[0]
  }
  return path
}

export function ancestorPath(nodes: NodeRow[], nodeId: string) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const path: NodeRow[] = []
  const seen = new Set<string>()
  let current = byId.get(nodeId)
  while (current) {
    if (seen.has(current.id)) throw new Error("Message graph contains a cycle")
    seen.add(current.id)
    path.unshift(current)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return path
}

/**
 * Branch id of a message. The node's own index is not part of its id.
 * A parent index above 0 appends `/{index}`; null and 0 leave the parent id.
 * A message with no parent is the empty id.
 */
export function branchIdOf(
  nodes: ReadonlyArray<{
    id: string
    parent_id: string | null
    branch_index: number | null
  }>,
  nodeId: string
): string {
  return branchIdsOf(nodes).get(nodeId) ?? ""
}

/** Resolve branch ids for a whole graph in linear time. */
export function branchIdsOf(
  nodes: ReadonlyArray<{
    id: string
    parent_id: string | null
    branch_index: number | null
  }>
): Map<string, string> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const branchIds = new Map<string, string>()

  for (const node of nodes) {
    if (branchIds.has(node.id)) continue
    const chain: Array<(typeof nodes)[number]> = []
    const seen = new Set<string>()
    let current: (typeof nodes)[number] | undefined = node
    while (current && !branchIds.has(current.id) && !seen.has(current.id)) {
      seen.add(current.id)
      chain.push(current)
      current = current.parent_id ? byId.get(current.parent_id) : undefined
    }

    let branchId = current ? (branchIds.get(current.id) ?? "") : ""
    for (let index = chain.length - 1; index >= 0; index--) {
      const child = chain[index]!
      const parent = child.parent_id ? byId.get(child.parent_id) : undefined
      if (parent) {
        branchId = branchIds.get(parent.id) ?? branchId
        if (parent.branch_index != null && parent.branch_index > 0)
          branchId += `/${parent.branch_index}`
      } else {
        branchId = ""
      }
      branchIds.set(child.id, branchId)
    }
  }

  return branchIds
}

/** Branch id a new child of `parentId` will receive once that parent is minted. */
export function branchIdForContinuation(
  nodes: ReadonlyArray<{
    id: string
    parent_id: string | null
    branch_index: number | null
  }>,
  parentId: string | null
): string {
  if (!parentId) return ""
  const parent = nodes.find((node) => node.id === parentId)
  if (!parent) return ""
  const index =
    parent.branch_index ??
    nextSiblingBranchIndex(
      nodes.filter(
        (node) => node.parent_id === parent.parent_id && node.id !== parent.id
      )
    )
  const base = branchIdOf(nodes, parentId)
  return index > 0 ? `${base}/${index}` : base
}

/**
 * Branch id of the assistant generated after a new user message is attached
 * under `parentId`. That user message is minted when the assistant is created,
 * so a later sibling's reply appends `/{n}` even though the user message's own
 * id does not.
 */
export function branchIdForAssistantAfterUserMessage(
  nodes: ReadonlyArray<{
    id: string
    parent_id: string | null
    branch_index: number | null
  }>,
  parentId: string | null
): string {
  const userBranchId = branchIdForContinuation(nodes, parentId)
  const userIndex = nextSiblingBranchIndex(
    nodes.filter((node) => node.parent_id === parentId)
  )
  return userIndex > 0 ? `${userBranchId}/${userIndex}` : userBranchId
}

function nextSiblingBranchIndex(
  siblings: ReadonlyArray<{ branch_index: number | null }>
) {
  return (
    siblings.reduce(
      (highest, row) =>
        row.branch_index == null
          ? highest
          : Math.max(highest, row.branch_index),
      -1
    ) + 1
  )
}

/** Collect a node and all descendants by parent_id (for subtree abort/delete). */
export function subtreeNodeIds(
  nodes: Array<{ id: string; parent_id: string | null }>,
  rootId: string
): Set<string> {
  const children = new Map<string | null, string[]>()
  for (const node of nodes) {
    const list = children.get(node.parent_id) ?? []
    list.push(node.id)
    children.set(node.parent_id, list)
  }
  const ids = new Set<string>()
  const stack = [rootId]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (ids.has(current)) continue
    ids.add(current)
    for (const child of children.get(current) ?? []) stack.push(child)
  }
  return ids
}
