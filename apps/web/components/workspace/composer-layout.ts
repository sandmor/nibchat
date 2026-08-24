export type ComposerSurface = "docked" | "inline"

/**
 * Compact field: grow with the draft, then scroll. Expanded raises the
 * ceiling so a long write still leaves the transcript or tree readable.
 */
export function composerFieldMinHeight(
  surface: ComposerSurface,
  expanded: boolean
) {
  if (!expanded) return "4.5rem"
  return surface === "inline" ? "min(28dvh, 12rem)" : "min(36dvh, 14rem)"
}

export function composerFieldMaxHeight(
  surface: ComposerSurface,
  expanded: boolean
) {
  if (expanded) {
    return surface === "inline" ? "min(42dvh, 20rem)" : "min(62dvh, 28rem)"
  }
  return surface === "inline" ? "min(28dvh, 12rem)" : "min(36dvh, 14rem)"
}

export type FieldOverflow = {
  top: boolean
  bottom: boolean
}

/** Scroll fades: which edge still has more draft past the cap. */
export function fieldOverflow(el: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}): FieldOverflow {
  const max = el.scrollHeight - el.clientHeight
  return {
    top: el.scrollTop > 1,
    bottom: max > 1 && el.scrollTop < max - 1,
  }
}

export function fieldOverflowEqual(a: FieldOverflow, b: FieldOverflow) {
  return a.top === b.top && a.bottom === b.bottom
}

/**
 * Used height when field-sizing ignores max-height. `null` means let the
 * engine size to content.
 */
export function clampedFieldHeight(
  scrollHeight: number,
  maxHeightPx: number | null
) {
  if (maxHeightPx == null || scrollHeight <= maxHeightPx + 1) return null
  return maxHeightPx
}

/** Lock a field to its computed max-height if the engine overflowed the cap. */
export function applyFieldHeightCap(el: HTMLElement) {
  const raw = getComputedStyle(el).maxHeight
  const max = raw === "none" || raw === "" ? Number.NaN : Number.parseFloat(raw)
  const next = clampedFieldHeight(
    el.scrollHeight,
    Number.isFinite(max) ? max : null
  )
  const height = next == null ? "" : `${next}px`
  if (el.style.height !== height) el.style.height = height
}
