import { siblingSort } from "@/lib/sort-key"
import type { MessageStatus, NodeRow } from "@/lib/types"

export function isUnfinishedMessage(node: { status: MessageStatus }): boolean {
  return node.status === "streaming" || node.status === "awaiting_input"
}

/** An unfinished tip is an alternative reply, never context for a new turn. */
export function composerContextParent(
  path: ReadonlyArray<Pick<NodeRow, "id" | "parent_id" | "status">>
): string | null {
  const tip = path.at(-1)
  return tip ? (isUnfinishedMessage(tip) ? tip.parent_id : tip.id) : null
}

/** Every child of a parent is an alternative branch, regardless of role. */
export function groupSiblingBranches(
  nodes: readonly NodeRow[]
): Map<string | null, NodeRow[]> {
  const groups = new Map<string | null, NodeRow[]>()
  for (const node of nodes) {
    const group = groups.get(node.parent_id)
    if (group) group.push(node)
    else groups.set(node.parent_id, [node])
  }
  for (const group of groups.values()) group.sort(siblingSort)
  return groups
}
