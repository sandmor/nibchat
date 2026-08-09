/**
 * Deterministic theme surface registry for the magic appearance editor.
 * Identity is the CSS custom property written into appearance.vars — never
 * sampled pixels. One ThemeSurface per token; multiple DOM hosts via targets.
 */

export type ThemeSurface = {
  id: string
  label: string
  /** data-theme-target values that hit this token for pick geometry */
  targets: string[]
  /** CSS custom property key written under appearance.vars */
  cssVar: `--${string}`
}

export const THEME_SURFACES: ThemeSurface[] = [
  {
    id: "sidebar",
    label: "Sidebar",
    targets: ["sidebar"],
    cssVar: "--sidebar",
  },
  {
    id: "background",
    label: "App background",
    targets: ["background"],
    cssVar: "--background",
  },
  {
    id: "primary",
    label: "Primary",
    targets: ["primary"],
    cssVar: "--primary",
  },
  {
    id: "muted",
    label: "Muted",
    targets: ["muted"],
    cssVar: "--muted",
  },
  {
    id: "card",
    label: "Card",
    // Composer reuses --card until a dedicated token exists.
    targets: ["card", "composer"],
    cssVar: "--card",
  },
]

const byTarget = new Map<string, ThemeSurface>()
for (const surface of THEME_SURFACES) {
  for (const target of surface.targets) {
    byTarget.set(target, surface)
  }
}
const byId = new Map(THEME_SURFACES.map((s) => [s.id, s]))

export function surfaceById(id: string): ThemeSurface | null {
  return byId.get(id) ?? null
}

export function surfaceByTarget(target: string): ThemeSurface | null {
  return byTarget.get(target) ?? null
}

/** All `data-theme-target` values that map to the same CSS custom property. */
export function targetsSharingCssVar(cssVar: string): string[] {
  return THEME_SURFACES.filter((s) => s.cssVar === cssVar).flatMap(
    (s) => s.targets
  )
}

/**
 * Live DOM nodes tagged with a target for this css var.
 * Safe when `document` is missing (SSR / unit tests).
 */
export function querySurfacesByCssVar(cssVar: string): Element[] {
  if (typeof document === "undefined") return []
  const out: Element[] = []
  for (const target of targetsSharingCssVar(cssVar)) {
    document
      .querySelectorAll(`[data-theme-target="${CSS.escape(target)}"]`)
      .forEach((el) => out.push(el))
  }
  return out
}

/**
 * Closest registered theme surface (buttons inside a region still pick that region).
 * Ignores magic chrome; unknown targets are no-ops.
 */
export function resolveThemeTarget(el: Element | null): ThemeSurface | null {
  if (!el || typeof el.closest !== "function") return null
  if (el.closest("[data-magic-chrome]")) return null

  const host = el.closest("[data-theme-target]")
  if (!host) return null
  const target = host.getAttribute("data-theme-target")
  if (!target) return null
  return byTarget.get(target) ?? null
}

/**
 * Hit-test under a viewport point for pick mode.
 * Skips magic chrome / portal ghosts (pointer-events: none + data-magic-chrome).
 * Selection identity is the real surface under the cursor, never an aura ghost.
 */
export function resolveThemeTargetAtPoint(
  x: number,
  y: number
): ThemeSurface | null {
  if (typeof document === "undefined") return null
  const stack = document.elementsFromPoint(x, y)
  for (const el of stack) {
    // Node test env may lack Element; duck-type DOM nodes.
    if (!el || typeof (el as Element).closest !== "function") continue
    if ((el as Element).closest("[data-magic-chrome]")) continue
    const surface = resolveThemeTarget(el as Element)
    if (surface) return surface
  }
  return null
}
