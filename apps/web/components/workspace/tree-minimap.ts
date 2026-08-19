import type { NodeRow } from "@/lib/types"
import {
  isAddId,
  type TreeEdge,
  type TreeLayout,
  type TreeRect,
} from "./tree-layout"

export type MinimapMark = {
  x: number
  y: number
  width: number
  height: number
}

export type MinimapCardSketch = {
  rail: MinimapMark
  glyphs: MinimapMark[]
  user: boolean
  error: boolean
}

const VIEW_PAD = 40
const GLYPH_COLS = 52

/** Plus controls keep world spacing; the minimap only maps messages. */
export function minimapEdges(layout: TreeLayout): TreeEdge[] {
  return layout.edges.filter((edge) => !isAddId(edge.from) && !isAddId(edge.to))
}

/** Crop the plus-button gutter so the map frames real cards. */
export function minimapViewBox(layout: TreeLayout, pad = VIEW_PAD): TreeRect {
  const cards: TreeRect[] = []
  for (const [id, rect] of layout.rects) {
    if (!isAddId(id)) cards.push(rect)
  }
  if (cards.length === 0) return layout.bounds
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const rect of cards) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  }
}

/**
 * Tiny schematic of a message card: left role rail plus text-shaped bars
 * whose count and width follow search_text so siblings do not look identical.
 */
export function minimapCardSketch(
  node: Pick<NodeRow, "role" | "status" | "search_text">,
  rect: TreeRect
): MinimapCardSketch {
  const padX = rect.width * 0.1
  const padY = rect.height * 0.16
  const rail: MinimapMark = {
    x: rect.x + rect.width * 0.045,
    y: rect.y + padY,
    width: rect.width * 0.055,
    height: Math.max(0, rect.height - padY * 2),
  }
  const innerX = rail.x + rail.width + rect.width * 0.045
  const innerW = Math.max(0, rect.x + rect.width - padX - innerX)
  const lineH = Math.max(8, rect.height * 0.09)
  const gap = Math.max(6, rect.height * 0.065)
  const room = Math.max(0, rect.height - padY * 2)
  const slots = Math.min(
    4,
    Math.max(1, Math.floor((room + gap) / (lineH + gap)))
  )
  const text = node.search_text.trim()
  const needed = text
    ? Math.min(slots, Math.max(1, Math.ceil(text.length / GLYPH_COLS)))
    : 1
  const glyphs: MinimapMark[] = []
  for (let i = 0; i < needed; i++) {
    const slice = text.slice(i * GLYPH_COLS, (i + 1) * GLYPH_COLS)
    const last = i === needed - 1
    const fullness = text ? Math.min(1, Math.max(0.28, slice.length / 40)) : 0.4
    const width =
      innerW * (last && needed > 1 ? Math.min(0.7, fullness) : fullness)
    glyphs.push({
      x: innerX,
      y: rect.y + padY + i * (lineH + gap),
      width: Math.max(innerW * 0.3, width),
      height: lineH,
    })
  }
  return {
    rail,
    glyphs,
    user: node.role === "user",
    error: node.status === "error",
  }
}
