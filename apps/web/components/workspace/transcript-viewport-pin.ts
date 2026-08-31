import { PureComponent, type RefObject } from "react"

/**
 * Preserve the in-view transcript slot across linear path rewrites
 * (edit/fork/regenerate). MessageScroller only auto-follows the live edge;
 * this pin is for when the reader has scrolled away.
 */

/** Matches @shadcn/react message-scroller's default scrollEdgeThreshold. */
export const TRANSCRIPT_LIVE_EDGE_PX = 8

export const TRANSCRIPT_ITEM_SELECTOR = '[data-slot="message-scroller-item"]'

export type ViewportPinItem = {
  element: Element
  offset: number
}

export type ViewportPin = {
  items: ViewportPinItem[]
}

type PathRewriteViewportPinProps = {
  pathSignature: string
  scrollTargetId: string | null
  viewportRef: RefObject<HTMLDivElement | null>
}

export function isTranscriptLiveEdge(
  viewport: {
    scrollTop: number
    scrollHeight: number
    clientHeight: number
  },
  threshold = TRANSCRIPT_LIVE_EDGE_PX
): boolean {
  return (
    viewport.scrollTop >=
    viewport.scrollHeight - viewport.clientHeight - threshold
  )
}

/** First still-connected pin, in capture order (top-most visible first). */
export function pickRestorePin<T>(
  items: readonly T[],
  isConnected: (item: T) => boolean
): T | null {
  for (const item of items) {
    if (isConnected(item)) return item
  }
  return null
}

function itemOffset(element: Element, viewport: Element): number {
  return (
    element.getBoundingClientRect().top - viewport.getBoundingClientRect().top
  )
}

export function captureViewportPin(viewport: HTMLElement): ViewportPin {
  const view = viewport.getBoundingClientRect()
  const items: ViewportPinItem[] = []
  for (const el of viewport.querySelectorAll(TRANSCRIPT_ITEM_SELECTOR)) {
    const rect = el.getBoundingClientRect()
    if (rect.bottom > view.top && rect.top < view.bottom) {
      items.push({ element: el, offset: rect.top - view.top })
    }
  }
  return { items }
}

export function restoreViewportPin(
  viewport: HTMLElement,
  pin: ViewportPin | null
): boolean {
  if (!pin) return false
  const item = pickRestorePin(pin.items, (entry) => entry.element.isConnected)
  if (!item) return false
  const delta = itemOffset(item.element, viewport) - item.offset
  if (Math.abs(delta) < 0.5) return false
  viewport.scrollTop += delta
  return true
}

/**
 * React has no hook equivalent of getSnapshotBeforeUpdate. Keep this small
 * lifecycle bridge next to the capture/restore primitives so path renders stay
 * pure while the old DOM geometry is read immediately before a committed
 * rewrite mutates it.
 */
export class PathRewriteViewportPin extends PureComponent<PathRewriteViewportPinProps> {
  override getSnapshotBeforeUpdate(
    previousProps: Readonly<PathRewriteViewportPinProps>
  ): ViewportPin | null {
    const { pathSignature, scrollTargetId, viewportRef } = this.props
    if (pathSignature === previousProps.pathSignature || scrollTargetId) {
      return null
    }

    const viewport = viewportRef.current
    if (!viewport || isTranscriptLiveEdge(viewport)) return null
    return captureViewportPin(viewport)
  }

  override componentDidUpdate(
    _previousProps: Readonly<PathRewriteViewportPinProps>,
    _previousState: Readonly<Record<string, never>>,
    pin?: ViewportPin | null
  ) {
    const viewport = this.props.viewportRef.current
    if (!pin || !viewport) return
    restoreViewportPin(viewport, pin)
  }

  override render() {
    return null
  }
}
