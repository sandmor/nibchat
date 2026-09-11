/**
 * Color helpers for the magic appearance editor and the surface-ramp compiler.
 *
 * Stored tokens are oklch / color-mix / var() references. The custom picker
 * edits OKLCH; writes go back as oklch() literals or palette refs.
 */

import { converter, formatHex, interpolate, parse } from "culori"
import type { Oklch } from "culori"
import type { Appearance } from "@/lib/appearance"
import {
  CHROME_DELTAS,
  SURFACE_DELTAS,
  groupById,
  groupFill,
  isDeriveSource,
  isPaletteRole,
  isThemeGroupId,
  mix,
  parseSurfaceRef,
  surfaceRef,
  tokenById,
  type ColorValue,
  type SurfaceStep,
  type ThemeGroupId,
  type ThemeToken,
} from "@/lib/appearance-registry"

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

/** True when paper is darker than ink — cards need a real lift off the canvas. */
export function usesDarkElevation(doc: Appearance): boolean {
  return (
    cssColorToOklch(doc.palette.paper).l < cssColorToOklch(doc.palette.ink).l
  )
}

/**
 * Never spend more than this fraction of the remaining paper→ink span on one
 * mix. ΔL targeting still wins on seed palettes; tight custom palettes keep
 * a contrast budget for ink text instead of snapping surfaces to 100% ink.
 */
const MAX_MIX_TOWARD_INK = 0.4

function mixAmountForDelta(
  ontoCss: string,
  inkCss: string,
  delta: number
): number {
  if (delta <= 0) return 0
  const span = Math.abs(cssColorToOklch(inkCss).l - cssColorToOklch(ontoCss).l)
  if (span < 0.01) return 0
  return Math.min(MAX_MIX_TOWARD_INK, delta / span)
}

/** Shrink the whole ramp together so canvas < raised < … < control still holds. */
function surfaceRampScale(doc: Appearance): number {
  const scheme = usesDarkElevation(doc) ? "dark" : "light"
  const span = Math.abs(
    cssColorToOklch(doc.palette.ink).l - cssColorToOklch(doc.palette.paper).l
  )
  if (span < 0.01) return 0
  const peak = SURFACE_DELTAS.control[scheme]
  const budget = span * MAX_MIX_TOWARD_INK
  return peak > budget ? budget / peak : 1
}

export function surfaceStepValue(
  doc: Appearance,
  step: SurfaceStep
): ColorValue {
  const scheme = usesDarkElevation(doc) ? "dark" : "light"
  const amount = mixAmountForDelta(
    doc.palette.paper,
    doc.palette.ink,
    SURFACE_DELTAS[step][scheme] * surfaceRampScale(doc)
  )
  if (amount <= 0) return { ref: "paper" }
  return mix("ink", "paper", amount)
}

function mixTowardInk(
  doc: Appearance,
  onto: ColorValue,
  delta: number
): ColorValue {
  const amount = mixAmountForDelta(
    resolveColorValue(doc, onto),
    doc.palette.ink,
    delta
  )
  if (amount <= 0) return onto
  return mix("ink", onto, amount)
}

export function groupFillValue(
  doc: Appearance,
  groupId: ThemeGroupId
): ColorValue {
  const paint = doc.groups[groupId]?.fill
  if (paint) return paint
  const group = groupById(groupId)
  const fillToken = group ? tokenById(group.fillTokenId) : null
  if (!fillToken || isDeriveSource(fillToken.source)) return { ref: "paper" }
  return fillToken.source
}

/** ColorValue the compiler and picker use when a token has no override. */
export function defaultTokenRecipe(
  doc: Appearance,
  token: ThemeToken
): ColorValue {
  const source = token.source
  if (token.role === "fill") return groupFill(token.groupId)
  if (isDeriveSource(source)) {
    const scheme = usesDarkElevation(doc) ? "dark" : "light"
    const onto =
      source.onto === "canvas" ? surfaceRef("canvas") : groupFill(token.groupId)
    return mixTowardInk(doc, onto, CHROME_DELTAS[source.as][scheme])
  }
  return source
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
    if (groups.has(groupId)) return doc.palette.paper
    const nextGroups = new Set(groups)
    nextGroups.add(groupId)
    const next = isThemeGroupId(groupId)
      ? groupFillValue(doc, groupId)
      : { ref: "paper" as const }
    base = resolveColorValueInner(doc, next, nextGroups, depth + 1)
  } else {
    const step = parseSurfaceRef(value.ref)
    if (step) {
      base = resolveColorValueInner(
        doc,
        surfaceStepValue(doc, step),
        groups,
        depth + 1
      )
    } else if (isPaletteRole(value.ref)) {
      base = doc.palette[value.ref]
    } else {
      base = doc.palette.paper
    }
  }
  if (value.alpha != null && value.alpha < 1) {
    const color = cssColorToOklch(base)
    return formatOklch({ ...color, alpha: color.alpha * value.alpha })
  }
  return base
}

function paletteRefOf(value: ColorValue): string | null {
  if (!("ref" in value) || "mix" in value) return null
  if (isPaletteRole(value.ref) || value.ref.startsWith("extra:"))
    return value.ref
  return null
}

export type ColorBinding =
  | { kind: "palette"; ref: string }
  | { kind: "surface"; step: SurfaceStep }
  | { kind: "custom" }

/** Classify a stored value without collapsing ramp steps into palette seeds. */
export function colorBinding(
  doc: Appearance,
  value: ColorValue,
  depth = 0
): ColorBinding {
  if (depth > 8) return { kind: "custom" }
  const direct = paletteRefOf(value)
  if (direct) return { kind: "palette", ref: direct }
  if ("mix" in value || "literal" in value) return { kind: "custom" }
  const step = parseSurfaceRef(value.ref)
  if (step) return { kind: "surface", step }
  if (value.ref.startsWith("group:")) {
    const groupId = value.ref.slice(6)
    if (!isThemeGroupId(groupId)) return { kind: "custom" }
    return colorBinding(doc, groupFillValue(doc, groupId), depth + 1)
  }
  return { kind: "custom" }
}
