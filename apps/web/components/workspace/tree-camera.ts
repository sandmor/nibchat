import type { TreeRect } from "./tree-layout"
import type { ChatViewCamera } from "@/lib/chat-view-state"
import { TREE_MAX_SCALE, TREE_MIN_SCALE } from "@/lib/tree-camera-constants"

export type Camera = { x: number; y: number; scale: number }

export const MIN_SCALE = TREE_MIN_SCALE
export const MAX_SCALE = TREE_MAX_SCALE
export const PAN_THRESHOLD = 6
/** Floor used by centerOn when the caller does not pass a scale. */
export const CENTER_SCALE = 0.78
/** On-screen height below which a card is a filled rect, not readable text. */
export const STUB_SCREEN_PX = 32
/** Map → work. Default camera (0.82) and CENTER_SCALE sit here. */
export const WORK_ENTER = 0.78
/** Work → map. */
export const WORK_LEAVE = 0.68
export const DEFAULT_CAMERA: Camera = { x: 48, y: 36, scale: 0.82 }
export const VIEW_CULL_PAD = 240
/** Recull after the view has moved this far. Stays inside VIEW_CULL_PAD. */
export const VIEW_CULL_STEP = VIEW_CULL_PAD / 3

/** Canvas zoom language. Stub is decided per card from on-screen height. */
export type ZoomTier = "work" | "map"
export type NodePaint = "live" | "map" | "stub"

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

export function cameraEqual(a: Camera, b: Camera) {
  return a.x === b.x && a.y === b.y && a.scale === b.scale
}

/**
 * A durable camera is anchored to the nearest message card, rather than raw
 * CSS translation. This keeps the same meaningful place visible after a
 * viewport resize or a card-height reflow.
 */
export function cameraToPersistedView(
  camera: Camera,
  viewport: { width: number; height: number },
  rects: ReadonlyMap<string, TreeRect>,
  nodeIds: readonly string[]
): ChatViewCamera | null {
  if (viewport.width <= 0 || viewport.height <= 0) return null
  const cx = viewport.width / 2
  const cy = viewport.height / 2
  let best:
    | { id: string; x: number; y: number; distance: number }
    | undefined
  for (const id of nodeIds) {
    const rect = rects.get(id)
    if (!rect) continue
    const x = camera.x + (rect.x + rect.width / 2) * camera.scale
    const y = camera.y + (rect.y + rect.height / 2) * camera.scale
    const dx = (x - cx) / viewport.width
    const dy = (y - cy) / viewport.height
    const distance = dx * dx + dy * dy
    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance && id < best.id)
    )
      best = { id, x, y, distance }
  }
  if (!best) return null
  return {
    anchorNodeId: best.id,
    offsetX: (best.x - cx) / viewport.width,
    offsetY: (best.y - cy) / viewport.height,
    zoom: camera.scale,
  }
}

export function cameraFromPersistedView(
  saved: ChatViewCamera,
  viewport: { width: number; height: number },
  rects: ReadonlyMap<string, TreeRect>
): Camera | null {
  const rect = rects.get(saved.anchorNodeId)
  if (!rect || viewport.width <= 0 || viewport.height <= 0) return null
  const scale = clampScale(saved.zoom)
  return {
    scale,
    x:
      viewport.width * (0.5 + saved.offsetX) -
      (rect.x + rect.width / 2) * scale,
    y:
      viewport.height * (0.5 + saved.offsetY) -
      (rect.y + rect.height / 2) * scale,
  }
}

/** Unready or 0×0 views must not serialize; that would clear a saved camera. */
export function canCommitPersistedCamera(
  ready: boolean,
  viewport: { width: number; height: number }
) {
  return ready && viewport.width > 0 && viewport.height > 0
}

export function cameraTransform(camera: Camera) {
  return `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`
}

export function applyCameraTransform(
  element: { style: { transform: string } } | null,
  camera: Camera
) {
  if (!element) return
  element.style.transform = cameraTransform(camera)
}

/**
 * Keep connector strokes readable once scale drops below WORK_LEAVE.
 * Not tied to map-tier hysteresis: the 0.68–0.78 band is still near work size.
 */
export function edgeStrokeFactor(scale: number) {
  return scale < WORK_LEAVE ? WORK_LEAVE / scale : 1
}

export function applyZoomCssVars(
  element: {
    style: { setProperty: (name: string, value: string) => void }
  } | null,
  scale: number
) {
  if (!element) return
  const factor = edgeStrokeFactor(scale)
  element.style.setProperty("--tree-edge-width", `${1.5 * factor}px`)
  element.style.setProperty("--tree-edge-lit-width", `${3 * factor}px`)
}

export function applyMinimapView(
  elements: ArrayLike<{ setAttribute: (name: string, value: string) => void }>,
  camera: Camera,
  viewport: { width: number; height: number }
) {
  if (viewport.width <= 0 || viewport.height <= 0) return
  const view = worldViewRect(camera, viewport)
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]
    if (!el) continue
    el.setAttribute("x", String(view.x))
    el.setAttribute("y", String(view.y))
    el.setAttribute("width", String(view.width))
    el.setAttribute("height", String(view.height))
  }
}

export function visibleIds(
  rects: ReadonlyMap<string, TreeRect>,
  view: TreeRect,
  pad = VIEW_CULL_PAD
) {
  const ids: string[] = []
  for (const [id, rect] of rects) {
    if (rectsOverlap(rect, view, pad)) ids.push(id)
  }
  ids.sort()
  return ids
}

export function visibleSignature(ids: readonly string[]) {
  return ids.join("\0")
}

export type TreeViewSnapshot = {
  sig: string
  ids: ReadonlySet<string>
  scale: number
  tier: ZoomTier
  paintSig: string
}

export function viewNeedsRecull(
  last: TreeRect | null,
  next: TreeRect,
  scaleChanged: boolean
) {
  if (scaleChanged || !last) return true
  return (
    Math.abs(next.x - last.x) >= VIEW_CULL_STEP ||
    Math.abs(next.y - last.y) >= VIEW_CULL_STEP ||
    Math.abs(next.width - last.width) >= VIEW_CULL_STEP ||
    Math.abs(next.height - last.height) >= VIEW_CULL_STEP
  )
}

export function treeViewSnapshot(
  rects: ReadonlyMap<string, TreeRect>,
  camera: Camera,
  viewport: { width: number; height: number },
  tier: ZoomTier,
  previous?: TreeViewSnapshot
): TreeViewSnapshot {
  const nextTier = stepZoomTier(tier, camera.scale)
  const ids = visibleIds(rects, worldViewRect(camera, viewport))
  const sig = visibleSignature(ids)
  if (
    previous &&
    sig === previous.sig &&
    nextTier === previous.tier &&
    camera.scale === previous.scale
  )
    return previous
  return {
    sig,
    ids: new Set(ids),
    scale: camera.scale,
    tier: nextTier,
    paintSig: ids
      .map((id) => {
        const rect = rects.get(id)
        if (!rect) return id
        return `${id}:${nodePaint({
          rect,
          scale: camera.scale,
          tier: nextTier,
          interactive: false,
        })}`
      })
      .join("|"),
  }
}

export function createTreeViewStore(initial: TreeViewSnapshot) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    subscribe(onStoreChange: () => void) {
      listeners.add(onStoreChange)
      return () => {
        listeners.delete(onStoreChange)
      }
    },
    getSnapshot() {
      return snapshot
    },
    commit(next: TreeViewSnapshot) {
      if (
        next.sig === snapshot.sig &&
        next.paintSig === snapshot.paintSig &&
        next.tier === snapshot.tier
      )
        return false
      snapshot = next
      for (const listener of listeners) listener()
      return true
    },
  }
}

/**
 * Dual thresholds so work/map does not flap around the boundary.
 * Stub is not a canvas tier — it is per-card paint.
 */
export function stepZoomTier(current: ZoomTier, scale: number): ZoomTier {
  if (current === "work") return scale <= WORK_LEAVE ? "map" : "work"
  return scale >= WORK_ENTER ? "work" : "map"
}

/**
 * Geometry stubs are only for cards too small to read. Map plaques replace
 * markdown once the canvas leaves work zoom. Interactive cards stay live.
 */
export function nodePaint(options: {
  rect: TreeRect
  scale: number
  tier: ZoomTier
  interactive: boolean
}): NodePaint {
  if (options.interactive) return "live"
  if (options.rect.height * options.scale < STUB_SCREEN_PX) return "stub"
  if (options.tier === "map") return "map"
  return "live"
}

/**
 * Scale that keeps a card live (readable markdown).
 * Floors at work-enter so zoomed-out reveals leave map/stub, then raises
 * further if that would remain a stub.
 */
export function scaleForLivePaint(rect: TreeRect, currentScale: number) {
  const liveMin = STUB_SCREEN_PX / Math.max(rect.height, 1) + 1e-6
  return clampScale(Math.max(currentScale, CENTER_SCALE, WORK_ENTER, liveMin))
}

/** Current scale when the card already paints live; otherwise a readable one. */
export function scaleToReadCard(
  rect: TreeRect,
  camera: Camera,
  tier: ZoomTier
): number {
  if (
    nodePaint({
      rect,
      scale: camera.scale,
      tier,
      interactive: false,
    }) === "live"
  )
    return camera.scale
  return scaleForLivePaint(rect, camera.scale)
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

/**
 * Canvas cards tag three roles:
 * - `[data-tree-hit]` clickable id
 * - `[data-tree-live]` readable card (text select when focused). Map plaques omit this.
 * - `[data-tree-scroll]` the overflow port. Sticky action rows sit beside it, not in it.
 * `[data-tree-chrome]` is overlays (minimap, composer). Chrome that is itself a
 * scrollport also carries `[data-tree-scroll]`.
 */
function firstScrollable(
  elements: Iterable<Element>,
  deltaX: number,
  deltaY: number
) {
  for (const el of elements) {
    if (el instanceof HTMLElement && elementCanScroll(el, deltaX, deltaY))
      return el
  }
  return null
}

/** Overflow port that can still consume this delta, or null to pan the canvas. */
export function treeWheelScroller(
  target: EventTarget | null,
  deltaX: number,
  deltaY: number
) {
  const start = eventElement(target)
  if (!start) return null
  const live = start.closest("[data-tree-live]")
  const labeled = start.closest("[data-tree-scroll]")
  const scope =
    live instanceof HTMLElement && labeled && live.contains(labeled)
      ? live
      : labeled instanceof HTMLElement
        ? labeled
        : live instanceof HTMLElement
          ? live
          : null
  if (!scope) return null
  let current: HTMLElement | null =
    start instanceof HTMLElement ? start : start.parentElement
  while (current) {
    if (elementCanScroll(current, deltaX, deltaY)) return current
    if (current === scope) break
    current = current.parentElement
  }
  if (!scope.hasAttribute("data-tree-live")) return null
  return firstScrollable(
    scope.querySelectorAll("[data-tree-scroll]"),
    deltaX,
    deltaY
  )
}

function isUnscrolledChrome(start: Element) {
  return Boolean(
    start.closest("[data-tree-chrome]") && !start.closest("[data-tree-scroll]")
  )
}

/** Let composers and overflowing cards keep wheel / drag; otherwise the canvas pans. */
export function wheelTargetScrolls(
  target: EventTarget | null,
  deltaX: number,
  deltaY: number
) {
  const start = eventElement(target)
  if (!start) return false
  if (isUnscrolledChrome(start)) return true
  return treeWheelScroller(start, deltaX, deltaY) != null
}

/**
 * Consume a wheel that belongs to a tree card or overlay.
 * Action-row wheels are not inside the scrollport, so this applies the delta
 * there; wheels over the port itself stay native.
 */
export function consumeTreeWheel(event: {
  target: EventTarget | null
  deltaX: number
  deltaY: number
  preventDefault: () => void
}) {
  const start = eventElement(event.target)
  if (!start) return false
  if (isUnscrolledChrome(start)) return true
  const scroller = treeWheelScroller(start, event.deltaX, event.deltaY)
  if (!scroller) return false
  if (!scroller.contains(start)) {
    event.preventDefault()
    scroller.scrollLeft += event.deltaX
    scroller.scrollTop += event.deltaY
  }
  return true
}

/** Focused live cards keep the pointer so drag-select works; others pan. */
export function pointerOnFocusedSelectable(
  target: EventTarget | null,
  focusedId: string | null
) {
  if (!focusedId) return false
  const start = eventElement(target)
  if (!start) return false
  const hit = start.closest("[data-tree-hit]")
  if (!(hit instanceof HTMLElement)) return false
  if (hit.getAttribute("data-tree-hit") !== focusedId) return false
  return hit.hasAttribute("data-tree-live")
}
