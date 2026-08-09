/**
 * Color helpers for the magic appearance editor.
 *
 * Stored tokens are typically oklch(...); react-colorful uses hex. Writes go
 * back to oklch so appearance JSON matches presets. Edit SOT is draft.vars —
 * never getComputedStyle sampling. Conversion via culori.
 */

import { converter, formatHex, parse } from "culori"
import type { Oklch } from "culori"

const toOklch = converter("oklch")

function formatOklch(color: Oklch): string {
  const L = Math.round((color.l ?? 0) * 1000) / 1000
  const C = Math.round((color.c ?? 0) * 1000) / 1000
  if (C < 0.001 || color.h == null || !Number.isFinite(color.h)) {
    return `oklch(${L} 0 0)`
  }
  const H = Math.round(color.h * 10) / 10
  return `oklch(${L} ${C} ${H})`
}

/** Convert a stored CSS color to #rrggbb for react-colorful. */
export function cssColorToHex(
  value: string | undefined,
  fallback = "#ffffff"
): string {
  if (!value) return fallback
  const color = parse(value.trim())
  if (!color) return fallback
  return formatHex(color) ?? fallback
}

/**
 * Convert picker hex → stable oklch() string for appearance.vars.
 */
export function hexToOklchCss(hex: string): string {
  const color = parse(hex.trim())
  if (!color) return "oklch(0.5 0 0)"
  const oklch = toOklch(color)
  if (!oklch || oklch.mode !== "oklch") return "oklch(0.5 0 0)"
  return formatOklch(oklch)
}
