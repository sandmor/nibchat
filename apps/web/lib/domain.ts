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
export const textFromParts = (parts: Parts) =>
  parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")

export function resolveActivePath(nodes: NodeRow[], rootId: string | null) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  let current = rootId
    ? byId.get(rootId)
    : nodes.find((node) => !node.parent_id)
  const path: NodeRow[] = []
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    path.push(current)
    seen.add(current.id)
    current = current.selected_child_id
      ? byId.get(current.selected_child_id)
      : undefined
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
