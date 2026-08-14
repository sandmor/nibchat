import type { TreeRect } from "./tree-layout"

export type Camera = { x: number; y: number; scale: number }

export const MIN_SCALE = 0.2
export const MAX_SCALE = 1.2
export const PAN_THRESHOLD = 6
/** On-screen height below which a card is a filled rect, not readable text. */
export const STUB_SCREEN_PX = 32

export function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x + dx, y: camera.y + dy }
}

/** Zoom so the given viewport point stays pinned to the same world point. */
export function zoomToward(
  camera: Camera,
  factor: number,
  point: { x: number; y: number }
): Camera {
  const scale = clampScale(camera.scale * factor)
  return {
    scale,
    x: point.x - ((point.x - camera.x) / camera.scale) * scale,
    y: point.y - ((point.y - camera.y) / camera.scale) * scale,
  }
}

export function centerOnRect(
  camera: Camera,
  rect: TreeRect,
  viewport: { width: number; height: number },
  scale = camera.scale
): Camera {
  const nextScale = clampScale(scale)
  return {
    scale: nextScale,
    x: viewport.width / 2 - (rect.x + rect.width / 2) * nextScale,
    y: viewport.height / 2 - (rect.y + rect.height / 2) * nextScale,
  }
}

export function rectFullyVisible(
  rect: TreeRect,
  camera: Camera,
  viewport: { width: number; height: number },
  pad = 24
) {
  const view = worldViewRect(camera, viewport)
  return (
    rect.x >= view.x + pad &&
    rect.y >= view.y + pad &&
    rect.x + rect.width <= view.x + view.width - pad &&
    rect.y + rect.height <= view.y + view.height - pad
  )
}

export function worldViewRect(
  camera: Camera,
  viewport: { width: number; height: number }
): TreeRect {
  return {
    x: -camera.x / camera.scale,
    y: -camera.y / camera.scale,
    width: viewport.width / camera.scale,
    height: viewport.height / camera.scale,
  }
}

export function rectsOverlap(a: TreeRect, b: TreeRect, pad = 0) {
  return (
    a.x < b.x + b.width + pad &&
    a.x + a.width + pad > b.x &&
    a.y < b.y + b.height + pad &&
    a.y + a.height + pad > b.y
  )
}

export type NodePaint = "stub" | "live"

/**
 * Geometry stubs are only for cards too small to read. Anything large enough
 * on screen mounts the real message (markdown, reasoning, tools).
 */
export function nodePaint(options: {
  rect: TreeRect
  scale: number
  interactive: boolean
}): NodePaint {
  if (options.interactive) return "live"
  if (options.rect.height * options.scale < STUB_SCREEN_PX) return "stub"
  return "live"
}

export type ScrollMetrics = {
  scrollHeight: number
  clientHeight: number
  scrollTop: number
  scrollWidth: number
  clientWidth: number
  scrollLeft: number
}

export function elementCanScroll(
  element: ScrollMetrics,
  deltaX: number,
  deltaY: number
) {
  if (Math.abs(deltaY) >= Math.abs(deltaX)) {
    const max = element.scrollHeight - element.clientHeight
    if (max <= 1) return false
    if (deltaY < 0) return element.scrollTop > 0
    return element.scrollTop < max - 1
  }
  const max = element.scrollWidth - element.clientWidth
  if (max <= 1) return false
  if (deltaX < 0) return element.scrollLeft > 0
  return element.scrollLeft < max - 1
}

function eventElement(target: EventTarget | null): Element | null {
  if (!target || typeof Element === "undefined") return null
  if (target instanceof Element) return target
  if (typeof Node !== "undefined" && target instanceof Node)
    return target.parentElement
  return null
}

/** Let composers and overflowing cards keep wheel / drag; otherwise the canvas pans. */
export function wheelTargetScrolls(
  target: EventTarget | null,
  deltaX: number,
  deltaY: number
) {
  const start = eventElement(target)
  if (!start) return false
  if (start.closest("[data-tree-chrome]:not([data-tree-scroll])")) return true
  const card = start.closest("[data-tree-scroll]")
  if (!(card instanceof HTMLElement)) return false
  let current: HTMLElement | null =
    start instanceof HTMLElement ? start : start.parentElement
  while (current) {
    if (elementCanScroll(current, deltaX, deltaY)) return true
    if (current === card) break
    current = current.parentElement
  }
  return false
}
