/** Extra height before a block is treated as long enough to jump. */
export const LONG_BLOCK_OVERFLOW_SLACK_PX = 48

export function nearestScrollport(el: Element | null): HTMLElement | null {
  let current = el?.parentElement ?? null
  while (current) {
    const overflowY = getComputedStyle(current).overflowY
    if (overflowY === "auto" || overflowY === "scroll") return current
    current = current.parentElement
  }
  return null
}

export function isBlockOverflowing(
  blockHeight: number,
  portHeight: number,
  slackPx = LONG_BLOCK_OVERFLOW_SLACK_PX
): boolean {
  return blockHeight > portHeight + slackPx
}

export function scrollDeltaToAlign(
  block: { top: number; bottom: number },
  port: { top: number; bottom: number },
  align: "start" | "end"
): number {
  if (align === "start") return block.top - port.top
  return block.bottom - port.bottom
}

export function blockEdgeVisibility(
  block: { top: number; bottom: number },
  port: { top: number; bottom: number },
  slackPx = 2
): { startVisible: boolean; endVisible: boolean } {
  return {
    startVisible: block.top >= port.top - slackPx && block.top < port.bottom,
    endVisible:
      block.bottom <= port.bottom + slackPx && block.bottom > port.top,
  }
}

export function alignBlockInScrollport(
  block: HTMLElement,
  align: "start" | "end",
  port = nearestScrollport(block)
): void {
  if (!port) return
  const delta = scrollDeltaToAlign(
    block.getBoundingClientRect(),
    port.getBoundingClientRect(),
    align
  )
  if (delta === 0) return
  port.scrollTo({
    top: port.scrollTop + delta,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
  })
}

/** Prefer the message article when the frame wraps chrome around it. */
export function navMeasureTarget(block: HTMLElement): HTMLElement {
  const article = block.querySelector(":scope > article")
  return article instanceof HTMLElement ? article : block
}
