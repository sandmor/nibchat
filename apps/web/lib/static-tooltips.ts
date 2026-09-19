const TRIGGER = "[data-static-tooltip]"
const POPUP_ID = "static-control-tooltip"
const SHOW_DELAY = 400

function tooltipTrigger(target: EventTarget | null) {
  return target instanceof Element ? target.closest<HTMLElement>(TRIGGER) : null
}

function isKeyboardFocused(target: HTMLElement) {
  return target.isConnected && target.matches(":focus-visible")
}

/** One imperative tooltip popup shared by cached HTML controls. */
class StaticTooltipController {
  private active: HTMLElement | null = null
  private hovered: HTMLElement | null = null
  private pendingTarget: HTMLElement | null = null
  private pending: number | null = null
  private recoverFrame = 0
  private pointer = { x: 0, y: 0 }
  private mutationObserver: MutationObserver | null = null
  private readonly popup: HTMLDivElement

  constructor() {
    this.popup = document.createElement("div")
    this.popup.id = POPUP_ID
    this.popup.dataset.staticTooltipPopup = ""
    this.popup.hidden = true
    this.popup.setAttribute("role", "tooltip")
    this.popup.setAttribute("aria-hidden", "true")
    document.body.append(this.popup)
    this.popup.addEventListener("animationend", this.onAnimationEnd)

    document.addEventListener("pointerover", this.onPointerOver)
    document.addEventListener("pointerout", this.onPointerOut)
    document.addEventListener("pointerdown", this.onPointerDown)
    document.addEventListener("pointermove", this.onPointerMove)
    document.addEventListener("focusin", this.onFocusIn)
    document.addEventListener("focusout", this.onFocusOut)
    document.addEventListener("keydown", this.onKeyDown)
    window.addEventListener("resize", this.sync)
    document.addEventListener("scroll", this.sync, true)
  }

  destroy() {
    this.dismiss()
    document.removeEventListener("pointerover", this.onPointerOver)
    document.removeEventListener("pointerout", this.onPointerOut)
    document.removeEventListener("pointerdown", this.onPointerDown)
    document.removeEventListener("pointermove", this.onPointerMove)
    document.removeEventListener("focusin", this.onFocusIn)
    document.removeEventListener("focusout", this.onFocusOut)
    document.removeEventListener("keydown", this.onKeyDown)
    window.removeEventListener("resize", this.sync)
    document.removeEventListener("scroll", this.sync, true)
    this.popup.removeEventListener("animationend", this.onAnimationEnd)
    this.popup.remove()
  }

  dismiss() {
    this.hovered = null
    this.clearPending()
    this.cancelRecover()
    this.unwatchDom()
    this.active?.removeAttribute("aria-describedby")
    this.active = null
    this.popup.setAttribute("aria-hidden", "true")
    this.popup.dataset.state = "closed"
    this.popup.hidden = true
  }

  /** Re-bind after cached HTML is swapped under a still cursor. */
  syncFromPoint() {
    const under = this.triggerAtPoint()
    if (under) {
      this.hovered = under
      if (this.active && this.active !== under) this.retarget(under)
      else if (this.active === under) this.position()
      else
        this.schedule(under, this.active || this.pendingTarget ? 0 : SHOW_DELAY)
      this.interest()
      return
    }
    if (this.active || this.pendingTarget) this.hide()
    this.hovered = null
    this.interest()
  }

  private rememberPoint(event: PointerEvent) {
    this.pointer.x = event.clientX
    this.pointer.y = event.clientY
  }

  private triggerAtPoint() {
    return tooltipTrigger(
      document.elementFromPoint(this.pointer.x, this.pointer.y)
    )
  }

  private cancelRecover() {
    if (!this.recoverFrame) return
    cancelAnimationFrame(this.recoverFrame)
    this.recoverFrame = 0
  }

  private watchDom() {
    if (this.mutationObserver || typeof MutationObserver === "undefined") return
    this.mutationObserver = new MutationObserver((records) => {
      if (
        records.every(
          (record) =>
            record.target === this.popup || this.popup.contains(record.target)
        )
      )
        return
      this.syncFromPoint()
    })
    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    })
  }

  private unwatchDom() {
    this.mutationObserver?.disconnect()
    this.mutationObserver = null
  }

  private interest() {
    if (this.active || this.pendingTarget || this.hovered) this.watchDom()
    else this.unwatchDom()
  }

  private clearPending() {
    if (this.pending !== null) window.clearTimeout(this.pending)
    this.pending = null
    this.pendingTarget = null
  }

  private engaged(target: HTMLElement) {
    return (
      (this.hovered === target && target.isConnected) ||
      isKeyboardFocused(target)
    )
  }

  private schedule(target: HTMLElement, delay = SHOW_DELAY) {
    if (this.active === target) return
    if (target.getAttribute("aria-expanded") === "true") return
    if (this.pendingTarget === target) return
    this.clearPending()
    this.pendingTarget = target
    this.pending = window.setTimeout(() => {
      this.pending = null
      this.pendingTarget = null
      if (this.engaged(target)) this.show(target)
      this.interest()
    }, delay)
    this.interest()
  }

  private show(target: HTMLElement) {
    const label = target.dataset.staticTooltip
    if (!label || !this.engaged(target)) return
    this.active?.removeAttribute("aria-describedby")
    this.active = target
    this.popup.textContent = label
    this.popup.hidden = false
    this.popup.dataset.state = "closed"
    void this.popup.offsetWidth
    this.popup.dataset.state = "open"
    this.popup.setAttribute("aria-hidden", "false")
    target.setAttribute("aria-describedby", POPUP_ID)
    this.position()
  }

  private retarget(target: HTMLElement) {
    const label = target.dataset.staticTooltip
    if (!label) {
      this.hide()
      return
    }
    this.clearPending()
    this.active?.removeAttribute("aria-describedby")
    this.active = target
    this.hovered = target
    this.popup.textContent = label
    target.setAttribute("aria-describedby", POPUP_ID)
    this.position()
  }

  private hide() {
    this.clearPending()
    this.cancelRecover()
    this.active?.removeAttribute("aria-describedby")
    this.active = null
    this.popup.setAttribute("aria-hidden", "true")
    if (!this.popup.hidden) this.popup.dataset.state = "closed"
    this.interest()
  }

  private releaseIfIdle = () => {
    const target = this.active
    if (target && !this.engaged(target)) this.hide()
  }

  private position = () => {
    const target = this.active
    if (!target) return
    if (!target.isConnected) {
      this.syncFromPoint()
      return
    }
    if (!this.engaged(target)) {
      this.hide()
      return
    }
    if (this.popup.hidden) return
    const rect = target.getBoundingClientRect()
    const popupRect = this.popup.getBoundingClientRect()
    const gap = Number(target.dataset.staticTooltipGap ?? 8)
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

  private sync = () => {
    if (this.active) this.position()
    else if (this.pendingTarget) this.syncFromPoint()
  }

  private onPointerMove = (event: PointerEvent) => {
    if (!this.active && !this.pendingTarget) return
    this.rememberPoint(event)
  }

  private onPointerOver = (event: PointerEvent) => {
    this.rememberPoint(event)
    const target = tooltipTrigger(event.target)
    if (!target) return
    if (tooltipTrigger(event.relatedTarget) === target) return
    this.hovered = target
    this.schedule(target)
    this.interest()
  }

  private onPointerOut = (event: PointerEvent) => {
    this.rememberPoint(event)
    const target = tooltipTrigger(event.target)
    if (!target) return
    if (tooltipTrigger(event.relatedTarget) === target) return

    const leave = () => {
      this.recoverFrame = 0
      const under = this.triggerAtPoint()
      if (under) {
        this.hovered = under
        if (this.active && this.active !== under) this.retarget(under)
        else if (!this.active)
          this.schedule(under, this.pendingTarget ? 0 : SHOW_DELAY)
        return
      }
      if (this.hovered === target) this.hovered = null
      if (target === this.active) this.hide()
      else if (this.pendingTarget === target) this.clearPending()
      this.interest()
    }

    if (!target.isConnected) {
      this.cancelRecover()
      this.recoverFrame = requestAnimationFrame(leave)
      return
    }
    leave()
  }

  private onPointerDown = () => this.dismiss()

  private onFocusIn = (event: FocusEvent) => {
    const target = tooltipTrigger(event.target)
    if (!target) return
    if (!isKeyboardFocused(target)) {
      this.releaseIfIdle()
      return
    }
    this.schedule(target, 0)
  }

  private onFocusOut = (event: FocusEvent) => {
    const target = tooltipTrigger(event.target)
    if (!target || tooltipTrigger(event.relatedTarget) === target) return
    if (target === this.active) this.hide()
    else if (this.pendingTarget === target) this.clearPending()
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") this.hide()
  }

  private onAnimationEnd = (event: AnimationEvent) => {
    if (
      event.target === this.popup &&
      event.animationName === "static-tooltip-out" &&
      this.popup.dataset.state === "closed"
    )
      this.popup.hidden = true
  }
}

let controller: StaticTooltipController | null = null
let consumers = 0

export function hideStaticTooltips() {
  controller?.dismiss()
}

export function syncStaticTooltips() {
  controller?.syncFromPoint()
}

export function retainStaticTooltips() {
  if (typeof document === "undefined") return () => undefined
  consumers += 1
  controller ??= new StaticTooltipController()
  return () => {
    consumers -= 1
    if (consumers > 0) return
    controller?.destroy()
    controller = null
  }
}
