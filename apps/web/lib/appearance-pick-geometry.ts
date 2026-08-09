/**
 * Geometry for pick-aura portal ghosts: full surface shapes with holes for
 * nested themed surfaces (e.g. sidebar in background), respecting border-radius.
 */

import {
  querySurfacesByCssVar,
  surfaceByTarget,
} from "@/lib/appearance-targets"

export type ViewportRect = {
  top: number
  left: number
  width: number
  height: number
}

/** Per-corner radii in px (CSS-clamped). */
export type CornerRadii = {
  tl: number
  tr: number
  br: number
  bl: number
}

export type RoundedViewportRect = ViewportRect & {
  radii: CornerRadii
}

export type PickGhostShape = {
  key: string
  outer: RoundedViewportRect
  holes: RoundedViewportRect[]
}

export const ZERO_RADII: CornerRadii = { tl: 0, tr: 0, br: 0, bl: 0 }

/** Intersection of two axis-aligned rects, or null if empty. */
export function intersectRects(
  a: ViewportRect,
  b: ViewportRect
): ViewportRect | null {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.left + a.width, b.left + b.width)
  const bottom = Math.min(a.top + a.height, b.top + b.height)
  if (right <= left || bottom <= top) return null
  return { left, top, width: right - left, height: bottom - top }
}

function parseCssPx(value: string): number {
  const m = value.trim().match(/^([0-9.]+)px/)
  if (m) return parseFloat(m[1]!)
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Read border radii from computed style and clamp so they never exceed half
 * the box (matches CSS behavior for large values like 9999px → pill).
 */
export function cornerRadiiFromComputed(
  cs: Pick<
    CSSStyleDeclaration,
    | "borderTopLeftRadius"
    | "borderTopRightRadius"
    | "borderBottomRightRadius"
    | "borderBottomLeftRadius"
  >,
  width: number,
  height: number
): CornerRadii {
  const maxR = Math.min(width, height) / 2
  const clamp = (v: number) => Math.max(0, Math.min(v, maxR))
  return {
    tl: clamp(parseCssPx(cs.borderTopLeftRadius)),
    tr: clamp(parseCssPx(cs.borderTopRightRadius)),
    br: clamp(parseCssPx(cs.borderBottomRightRadius)),
    bl: clamp(parseCssPx(cs.borderBottomLeftRadius)),
  }
}

/** SVG path subpath for a rounded rectangle (absolute coords, closed). */
export function roundedRectPath(
  rect: ViewportRect,
  radii: CornerRadii = ZERO_RADII
): string {
  const { left: x, top: y, width: w, height: h } = rect
  if (w < 0.5 || h < 0.5) return ""

  let { tl, tr, br, bl } = radii
  const maxR = Math.min(w, h) / 2
  tl = Math.min(tl, maxR)
  tr = Math.min(tr, maxR)
  br = Math.min(br, maxR)
  bl = Math.min(bl, maxR)

  if (tl + tr + br + bl < 0.5) {
    return `M${x} ${y}H${x + w}V${y + h}H${x}Z`
  }

  // Clockwise from after top-left corner (circular CSS radii)
  return [
    `M${x + tl} ${y}`,
    `H${x + w - tr}`,
    tr > 0 ? `A${tr} ${tr} 0 0 1 ${x + w} ${y + tr}` : "",
    `V${y + h - br}`,
    br > 0 ? `A${br} ${br} 0 0 1 ${x + w - br} ${y + h}` : "",
    `H${x + bl}`,
    bl > 0 ? `A${bl} ${bl} 0 0 1 ${x} ${y + h - bl}` : "",
    `V${y + tl}`,
    tl > 0 ? `A${tl} ${tl} 0 0 1 ${x + tl} ${y}` : "",
    "Z",
  ].join("")
}

/**
 * Evenodd SVG path: outer rounded rect with nested (rounded) holes.
 */
export function shapesToEvenOddPath(
  outer: RoundedViewportRect,
  holes: RoundedViewportRect[]
): string {
  let d = roundedRectPath(outer, outer.radii)
  for (const h of holes) {
    if (h.width < 0.5 || h.height < 0.5) continue
    d += roundedRectPath(h, h.radii)
  }
  return d
}

/**
 * Nested theme targets that carve this surface's visible area.
 * Descendants with a different css token are punched out.
 */
export function collectOccluderShapes(
  surfaceEl: Element
): RoundedViewportRect[] {
  const ownTarget = surfaceEl.getAttribute("data-theme-target")
  const ownVar = ownTarget ? surfaceByTarget(ownTarget)?.cssVar : null
  const outer = surfaceEl.getBoundingClientRect()
  const outerR: ViewportRect = {
    top: outer.top,
    left: outer.left,
    width: outer.width,
    height: outer.height,
  }

  const holes: RoundedViewportRect[] = []
  surfaceEl.querySelectorAll("[data-theme-target]").forEach((el) => {
    if (el === surfaceEl) return
    const t = el.getAttribute("data-theme-target")
    if (!t) return
    const v = surfaceByTarget(t)?.cssVar
    if (v && ownVar && v === ownVar) return
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return
    const clipped = intersectRects(outerR, {
      top: r.top,
      left: r.left,
      width: r.width,
      height: r.height,
    })
    if (!clipped) return
    const cs = getComputedStyle(el)
    const fullCover =
      Math.abs(clipped.width - r.width) < 0.5 &&
      Math.abs(clipped.height - r.height) < 0.5 &&
      Math.abs(clipped.left - r.left) < 0.5 &&
      Math.abs(clipped.top - r.top) < 0.5
    holes.push({
      ...clipped,
      radii: fullCover
        ? cornerRadiiFromComputed(cs, clipped.width, clipped.height)
        : ZERO_RADII,
    })
  })
  return holes
}

/** Measure portal ghost shapes for every live region using this css var. */
export function measurePickGhosts(cssVar: string | null): PickGhostShape[] {
  if (!cssVar || typeof document === "undefined") return []
  const vw = window.innerWidth
  const vh = window.innerHeight
  const ghosts: PickGhostShape[] = []
  const elements = querySurfacesByCssVar(cssVar)

  elements.forEach((el, index) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return
    if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) return
    const cs = getComputedStyle(el)
    const outer: RoundedViewportRect = {
      top: r.top,
      left: r.left,
      width: r.width,
      height: r.height,
      radii: cornerRadiiFromComputed(cs, r.width, r.height),
    }
    ghosts.push({
      key: `${cssVar}:${index}:${el.getAttribute("data-theme-target") ?? ""}`,
      outer,
      holes: collectOccluderShapes(el),
    })
  })

  return ghosts
}
