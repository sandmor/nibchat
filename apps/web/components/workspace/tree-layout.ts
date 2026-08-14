import type { NodeRow } from "@/lib/types"

export type TreeRect = { x: number; y: number; width: number; height: number }
export type TreeEdge = { from: string; to: string }
export type TreeLayout = {
  rects: Map<string, TreeRect>
  depths: Map<string, number>
  edges: TreeEdge[]
  bounds: TreeRect
}

export const ROOT_ADD_ID = "tree:add-root"
export const addId = (parentId: string) => `tree:add:${parentId}`
export const isAddId = (id: string) =>
  id === ROOT_ADD_ID || id.startsWith("tree:add:")
export const addAnchor = (id: string): string | null =>
  id === ROOT_ADD_ID ? null : id.slice("tree:add:".length)
export const composeLayoutId = (anchor: string | null) =>
  `tree-compose:${anchor ?? "root"}`
export const composeLayoutAnchor = (layoutId: string): string | null => {
  if (!layoutId.startsWith("tree-compose:")) return null
  const rest = layoutId.slice("tree-compose:".length)
  return rest === "root" ? null : rest
}

export const CARD_WIDTH = 360
export const ADD_SIZE = 48
const GAP_X = 48
const GAP_Y = 56
const PREVIEW_LINES = 5
const LINE_HEIGHT = 20
const CARD_CHROME = 64

/**
 * Cap for a message card. Paint may be shorter; it must not be taller, or
 * zoom / LOD / focus would reflow the forest.
 */
export function cardMaxHeight(node: NodeRow) {
  if (node.status === "streaming")
    return CARD_CHROME + PREVIEW_LINES * LINE_HEIGHT
  const lines = Math.min(
    PREVIEW_LINES,
    Math.max(2, Math.ceil((node.search_text.trim().length || 24) / 64))
  )
  return CARD_CHROME + lines * LINE_HEIGHT
}

type LayoutOptions = {
  /** Open plus-node composers. These occupy card width; height is measured. */
  draftAnchors?: ReadonlySet<string | null>
  /** Painted border-box heights, keyed by layout id. */
  sizes?: ReadonlyMap<string, number>
}

/**
 * Ordered tidy forest. Each item reserves its own width so siblings cannot
 * overlap. Synthetic plus nodes keep collision space and an edge, but are not
 * structural children for centering.
 */
export function layoutChatTree(
  nodes: NodeRow[],
  options: LayoutOptions = {}
): TreeLayout {
  const children = new Map<string | null, NodeRow[]>()
  for (const node of nodes) {
    const list = children.get(node.parent_id) ?? []
    list.push(node)
    children.set(node.parent_id, list)
  }
  for (const list of children.values())
    list.sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
    )

  const rects = new Map<string, TreeRect>()
  const depths = new Map<string, number>()
  const edges: TreeEdge[] = []
  const rowHeights = new Map<number, number>()
  const draftOpen = (id: string) =>
    Boolean(
      options.draftAnchors?.has(id === ROOT_ADD_ID ? null : addAnchor(id))
    )
  const itemHeight = (id: string, node?: NodeRow) => {
    const measured = options.sizes?.get(id)
    const usable = measured != null && measured >= 8 ? measured : undefined
    if (node) {
      const max = cardMaxHeight(node)
      return usable != null ? Math.min(usable, max) : max
    }
    if (draftOpen(id))
      return usable != null && usable > ADD_SIZE ? usable : ADD_SIZE
    return ADD_SIZE
  }
  const itemWidth = (id: string, node?: NodeRow) =>
    node || draftOpen(id) ? CARD_WIDTH : ADD_SIZE

  let cursor = 0
  const place = (id: string, depth: number, x: number, node?: NodeRow) => {
    const width = itemWidth(id, node)
    const height = itemHeight(id, node)
    rects.set(id, { x, y: 0, width, height })
    depths.set(id, depth)
    rowHeights.set(depth, Math.max(rowHeights.get(depth) ?? 0, height))
    return x + width / 2
  }
  const placeLeaf = (id: string, depth: number, node?: NodeRow) => {
    const width = itemWidth(id, node)
    const center = cursor + width / 2
    cursor += width + GAP_X
    place(id, depth, center - width / 2, node)
    return center
  }

  function visit(node: NodeRow, depth: number): number {
    const directChildren = children.get(node.id) ?? []
    if (directChildren.length === 0) {
      const center = placeLeaf(node.id, depth, node)
      const plus = addId(node.id)
      place(plus, depth + 1, center - itemWidth(plus) / 2)
      edges.push({ from: node.id, to: plus })
      return center
    }

    const subtreeStart = cursor
    const before = new Set(rects.keys())
    const childCenters: number[] = []
    for (const child of directChildren) {
      childCenters.push(visit(child, depth + 1))
      edges.push({ from: node.id, to: child.id })
    }

    const width = itemWidth(node.id, node)
    const height = itemHeight(node.id, node)
    let center = (childCenters[0]! + childCenters.at(-1)!) / 2
    const left = center - width / 2
    if (left < subtreeStart) {
      const shift = subtreeStart - left
      for (const [id, rect] of rects) if (!before.has(id)) rect.x += shift
      center += shift
      cursor += shift
    }
    rects.set(node.id, { x: center - width / 2, y: 0, width, height })
    depths.set(node.id, depth)
    rowHeights.set(depth, Math.max(rowHeights.get(depth) ?? 0, height))
    const rightmostChild = Math.max(
      ...directChildren.map((child) => {
        const rect = rects.get(child.id)!
        return rect.x + rect.width
      })
    )
    const plus = addId(node.id)
    const plusLeft = rightmostChild + GAP_X
    place(plus, depth + 1, plusLeft)
    edges.push({ from: node.id, to: plus })
    cursor = Math.max(
      cursor,
      plusLeft + itemWidth(plus) + GAP_X,
      center + width / 2 + GAP_X
    )
    return center
  }

  for (const root of children.get(null) ?? []) visit(root, 0)
  placeLeaf(ROOT_ADD_ID, 0)

  let y = 48
  const deepest = Math.max(0, ...depths.values())
  for (let depth = 0; depth <= deepest; depth++) {
    for (const [id, rect] of rects) if (depths.get(id) === depth) rect.y = y
    y += (rowHeights.get(depth) ?? 0) + GAP_Y
  }
  const values = [...rects.values()]
  const minX = Math.min(0, ...values.map((rect) => rect.x))
  const maxX = Math.max(0, ...values.map((rect) => rect.x + rect.width))
  const maxY = Math.max(0, ...values.map((rect) => rect.y + rect.height))
  const originX = minX
  if (originX !== 0) {
    for (const rect of rects.values()) rect.x -= originX
  }
  return {
    rects,
    depths,
    edges,
    bounds: {
      x: 0,
      y: 0,
      width: maxX - originX + 80,
      height: maxY + 80,
    },
  }
}
