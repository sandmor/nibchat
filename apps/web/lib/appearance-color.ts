/**
 * Color helpers for the magic appearance editor.
 *
 * Stored tokens are oklch / color-mix / var() references. The custom picker
 * edits OKLCH; writes go back as oklch() literals or palette refs.
 */

import { converter, formatHex, interpolate, parse } from "culori"
import type { Oklch } from "culori"
import type { Appearance } from "@/lib/appearance"
import { isPaletteRole, type ColorValue } from "@/lib/appearance-registry"

const toOklch = converter("oklch")

export type OklchColor = {
  l: number
  c: number
  h: number
  alpha: number
}

export function formatOklch(color: OklchColor): string {
  const L = Math.round(color.l * 1000) / 1000
  const C = Math.round(color.c * 1000) / 1000
  const A = Math.round(color.alpha * 1000) / 1000
  if (C < 0.001 || !Number.isFinite(color.h)) {
    return A < 1 ? `oklch(${L} 0 0 / ${A})` : `oklch(${L} 0 0)`
  }
  const H = Math.round(color.h * 10) / 10
  return A < 1 ? `oklch(${L} ${C} ${H} / ${A})` : `oklch(${L} ${C} ${H})`
}

export function cssColorToOklch(
  value: string | undefined,
  fallback: OklchColor = { l: 0.5, c: 0, h: 0, alpha: 1 }
): OklchColor {
  if (!value) return fallback
  const color = parse(value.trim())
  if (!color) return fallback
  const oklch = toOklch(color)
  if (!oklch || oklch.mode !== "oklch") return fallback
  return {
    l: oklch.l ?? 0,
    c: oklch.c ?? 0,
    h: oklch.h ?? 0,
    alpha: oklch.alpha ?? 1,
  }
}

export function oklchToHex(color: OklchColor): string {
  const parsed = parse(formatOklch({ ...color, alpha: 1 })) as Oklch | undefined
  if (!parsed) return "#808080"
  return formatHex(parsed) ?? "#808080"
}

function mixCss(from: string, onto: string, amount: number): string {
  const interp = interpolate([onto, from], "oklab")
  const mixed = interp(amount)
  if (!mixed) return onto
  const oklch = toOklch(mixed)
  if (!oklch) return onto
  return formatOklch({
    l: oklch.l ?? 0,
    c: oklch.c ?? 0,
    h: oklch.h ?? 0,
    alpha: oklch.alpha ?? 1,
  })
}

export function resolveColorValue(doc: Appearance, value: ColorValue): string {
  return resolveColorValueInner(doc, value, new Set(), 0)
}

function resolveColorValueInner(
  doc: Appearance,
  value: ColorValue,
  groups: Set<string>,
  depth: number
): string {
  if (depth > 24) return doc.palette.paper
  let base: string
  if ("literal" in value) {
    base = value.literal
  } else if ("mix" in value) {
    base = mixCss(
      resolveColorValueInner(doc, value.mix.from, groups, depth + 1),
      resolveColorValueInner(doc, value.mix.onto, groups, depth + 1),
      value.mix.amount
    )
  } else if (value.ref.startsWith("extra:")) {
    const extra = doc.palette.extras.find(
      (item) => item.id === value.ref.slice(6)
    )
    base = extra?.value ?? doc.palette.paper
  } else if (value.ref.startsWith("group:")) {
    const groupId = value.ref.slice(6)
    const fill = doc.groups[groupId]?.fill
    if (groups.has(groupId)) return doc.palette.paper
    const nextGroups = new Set(groups)
    nextGroups.add(groupId)
    base = fill
      ? resolveColorValueInner(doc, fill, nextGroups, depth + 1)
      : doc.palette.paper
  } else if (isPaletteRole(value.ref)) {
    base = doc.palette[value.ref]
  } else {
    base = doc.palette.paper
  }
  if (value.alpha != null && value.alpha < 1) {
    const color = cssColorToOklch(base)
    return formatOklch({ ...color, alpha: color.alpha * value.alpha })
  }
  return base
}

export function paletteRefOf(value: ColorValue): string | null {
  if (!("ref" in value) || "mix" in value) return null
  if (isPaletteRole(value.ref) || value.ref.startsWith("extra:"))
    return value.ref
  return null
}
