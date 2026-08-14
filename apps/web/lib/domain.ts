import type { NodeRow, Parts } from "@/lib/types"
import { textFromParts as textFromPartsImpl } from "@/lib/agent/parts"

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
  for (const siblings of children.values())
    siblings.sort(
      (left, right) =>
        left.created_at.localeCompare(right.created_at) ||
        left.id.localeCompare(right.id)
    )
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
  let current = byId.get(nodeId)
  while (current) {
    path.unshift(current)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return path
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
