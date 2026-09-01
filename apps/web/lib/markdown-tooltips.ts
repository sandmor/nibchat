const TRIGGER = "[data-markdown-tooltip]"
const POPUP_ID = "markdown-action-tooltip"
const SHOW_DELAY = 400

function tooltipTrigger(target: EventTarget | null) {
  return target instanceof Element ? target.closest<HTMLElement>(TRIGGER) : null
}

function remainsInside(trigger: HTMLElement, target: EventTarget | null) {
  return target instanceof Node && trigger.contains(target)
}

function isHovering(target: HTMLElement) {
  return target.isConnected && target.matches(":hover")
}

function isKeyboardFocused(target: HTMLElement) {
  return target.isConnected && target.matches(":focus-visible")
}

/**
 * One imperative tooltip popup for all cached Markdown controls. This mirrors
 * the app tooltip's delayed hover/focus behavior without adding a React
 * tooltip subtree for every completed message.
 */
class MarkdownTooltipController {
  private active: HTMLElement | null = null
  private pending: number | null = null
  private readonly popup: HTMLDivElement

  constructor() {
    this.popup = document.createElement("div")
    this.popup.id = POPUP_ID
    this.popup.dataset.markdownTooltipPopup = ""
    this.popup.hidden = true
    this.popup.setAttribute("role", "tooltip")
    this.popup.setAttribute("aria-hidden", "true")
    document.body.append(this.popup)
    this.popup.addEventListener("animationend", this.onAnimationEnd)

    document.addEventListener("pointerover", this.onPointerOver)
    document.addEventListener("pointerout", this.onPointerOut)
    document.addEventListener("pointerdown", this.onPointerDown)
    document.addEventListener("focusin", this.onFocusIn)
    document.addEventListener("focusout", this.onFocusOut)
    document.addEventListener("keydown", this.onKeyDown)
    window.addEventListener("resize", this.position)
    document.addEventListener("scroll", this.position, true)
  }

  destroy() {
    this.clearPending()
    this.hide()
    document.removeEventListener("pointerover", this.onPointerOver)
    document.removeEventListener("pointerout", this.onPointerOut)
    document.removeEventListener("pointerdown", this.onPointerDown)
    document.removeEventListener("focusin", this.onFocusIn)
    document.removeEventListener("focusout", this.onFocusOut)
    document.removeEventListener("keydown", this.onKeyDown)
    window.removeEventListener("resize", this.position)
    document.removeEventListener("scroll", this.position, true)
    this.popup.removeEventListener("animationend", this.onAnimationEnd)
    this.popup.remove()
  }

  private clearPending() {
    if (this.pending === null) return
    window.clearTimeout(this.pending)
    this.pending = null
  }

  private engaged(target: HTMLElement) {
    return isHovering(target) || isKeyboardFocused(target)
  }

  private schedule(target: HTMLElement, delay = SHOW_DELAY) {
    if (this.active === target) return
    if (target.getAttribute("aria-expanded") === "true") return
    this.clearPending()
    this.pending = window.setTimeout(() => {
      this.pending = null
      if (!this.engaged(target)) return
      this.show(target)
    }, delay)
  }

  private show(target: HTMLElement) {
    const label = target.dataset.markdownTooltip
    if (!label || !this.engaged(target)) return
    this.active?.removeAttribute("aria-describedby")
    this.active = target
    this.popup.textContent = label
    this.popup.hidden = false
    // Restart the enter animation if a prior target was still closing.
    this.popup.dataset.state = "closed"
    void this.popup.offsetWidth
    this.popup.dataset.state = "open"
    this.popup.setAttribute("aria-hidden", "false")
    target.setAttribute("aria-describedby", POPUP_ID)
    this.position()
  }

  dismiss() {
    this.clearPending()
    this.active?.removeAttribute("aria-describedby")
    this.active = null
    this.popup.setAttribute("aria-hidden", "true")
    this.popup.dataset.state = "closed"
    this.popup.hidden = true
  }

  private hide() {
    this.clearPending()
    this.active?.removeAttribute("aria-describedby")
    this.active = null
    this.popup.setAttribute("aria-hidden", "true")
    if (!this.popup.hidden) this.popup.dataset.state = "closed"
  }

  private releaseIfIdle = () => {
    const target = this.active
    if (target && !this.engaged(target)) this.hide()
  }

  private position = () => {
    const target = this.active
    if (!target) return
    if (!this.engaged(target)) {
      this.hide()
      return
    }
    if (this.popup.hidden) return
    const rect = target.getBoundingClientRect()
    const popupRect = this.popup.getBoundingClientRect()
    const gap = 8
    const side = rect.top >= popupRect.height + gap ? "top" : "bottom"
    const unclampedLeft = rect.left + rect.width / 2 - popupRect.width / 2
    const left = Math.min(
      Math.max(gap, unclampedLeft),
      Math.max(gap, window.innerWidth - popupRect.width - gap)
    )
    const top =
      side === "top" ? rect.top - popupRect.height - gap : rect.bottom + gap
    this.popup.dataset.side = side
    this.popup.style.left = `${left}px`
    this.popup.style.top = `${top}px`
  }

  private onPointerOver = (event: PointerEvent) => {
    const target = tooltipTrigger(event.target)
    if (target) this.schedule(target)
  }

  private onPointerOut = (event: PointerEvent) => {
    const target = tooltipTrigger(event.target)
    if (!target || remainsInside(target, event.relatedTarget)) return
    if (target === this.active) this.hide()
    else this.clearPending()
  }

  private onPointerDown = () => {
    this.dismiss()
  }

  private onFocusIn = (event: FocusEvent) => {
    const target = tooltipTrigger(event.target)
    if (!target) return
    // Click and dialog focus restoration are not keyboard focus. Showing on
    // those pins the tooltip until the next click, even with the pointer
    // nowhere near the control.
    if (!isKeyboardFocused(target)) {
      this.releaseIfIdle()
      return
    }
    this.schedule(target, 0)
  }

  private onFocusOut = (event: FocusEvent) => {
    const target = tooltipTrigger(event.target)
    if (!target || remainsInside(target, event.relatedTarget)) return
    if (target === this.active) this.hide()
    else this.clearPending()
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") this.hide()
  }

  private onAnimationEnd = (event: AnimationEvent) => {
    if (
      event.target === this.popup &&
      event.animationName === "markdown-tooltip-out" &&
      this.popup.dataset.state === "closed"
    ) {
      this.popup.hidden = true
    }
  }
}

let controller: MarkdownTooltipController | null = null
let consumers = 0

/** Hide the shared Markdown tooltip, e.g. when an action menu opens. */
export function hideMarkdownTooltips() {
  controller?.dismiss()
}

/** Install the single document-level controller while static Markdown exists. */
export function retainMarkdownTooltips() {
  if (typeof document === "undefined") return () => undefined
  consumers += 1
  controller ??= new MarkdownTooltipController()
  return () => {
    consumers -= 1
    if (consumers > 0) return
    controller?.destroy()
    controller = null
  }
}
