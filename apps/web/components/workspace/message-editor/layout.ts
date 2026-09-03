export type EditorSurface = "docked" | "inline"
export type EditorPurpose = "compose" | "edit"
export type EditorPlacement = "linear" | "tree"

const FIELD_MIN = "4.5rem"

/**
 * Compact field: grow with the draft, then scroll. Compose keeps a small
 * ceiling so the transcript stays readable. Message-edit uses a larger cap
 * because the bubble already owned that space.
 */
export function editorFieldMinHeight({
  purpose,
  surface,
  expanded = false,
}: {
  purpose: EditorPurpose
  surface: EditorSurface
  expanded?: boolean
}) {
  if (purpose === "edit" || !expanded) return FIELD_MIN
  return surface === "inline" ? "min(28dvh, 12rem)" : "min(36dvh, 14rem)"
}

export function editorFieldMaxHeight({
  purpose,
  surface,
  placement = "linear",
  expanded = false,
}: {
  purpose: EditorPurpose
  surface: EditorSurface
  placement?: EditorPlacement
  expanded?: boolean
}) {
  if (purpose === "edit") {
    // Tree cards drop their paint cap while editing and measure the live box.
    // Cap the field so a long answer cannot own the forest.
    if (placement === "tree") return "min(48dvh, 24rem)"
    return "min(70dvh, 40rem)"
  }
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
