import { composeLayoutAnchor, type TreeRect } from "./tree-layout"

export type TreeHandoff = {
  userNodeId: string
  anchor: string | null
  fromRect: TreeRect
}

/**
 * One overlay per sent user node. The source rect is captured by the Send
 * event, before async graph reconciliation can close or move the compose slot.
 */
export function collectHandoffs(
  morphs: Readonly<Record<string, string>>,
  nodeIds: ReadonlySet<string>,
  sources: ReadonlyMap<string, TreeRect>,
  nodeRects: ReadonlyMap<string, TreeRect>
): TreeHandoff[] {
  const next: TreeHandoff[] = []
  for (const [userNodeId, layoutId] of Object.entries(morphs)) {
    if (!nodeIds.has(userNodeId)) continue
    const toRect = nodeRects.get(userNodeId)
    const fromRect = sources.get(layoutId) ?? (toRect ? { ...toRect } : null)
    if (!fromRect) continue
    next.push({
      userNodeId,
      anchor: composeLayoutAnchor(layoutId),
      fromRect,
    })
  }
  return next
}

/** Unique compose anchors still waiting on a send morph. */
export function uniqueHandoffAnchors(
  morphs: Readonly<Record<string, string>>
): Array<string | null> {
  const seen = new Set<string>()
  const anchors: Array<string | null> = []
  for (const layoutId of Object.values(morphs)) {
    if (seen.has(layoutId)) continue
    seen.add(layoutId)
    anchors.push(composeLayoutAnchor(layoutId))
  }
  return anchors
}
