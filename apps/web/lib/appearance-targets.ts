/**
 * Deterministic theme surface + group registry for the magic appearance editor.
 * Identity is the CSS custom property / group id — never sampled pixels.
 * Hosts may be tagged before their token is registered; unregistered targets
 * fall through to the nearest registered ancestor.
 */

import {
  groupById,
  THEME_TOKENS,
  tokenById,
  tokenByTarget,
  type ThemeGroup,
  type ThemeGroupId,
  type ThemeToken,
} from "@/lib/appearance-registry"

export type ThemeSurface = {
  id: string
  label: string
  targets: string[]
  cssVar: `--${string}`
  groupId: ThemeGroupId
}

export type ThemeHit =
  | { kind: "group"; group: ThemeGroup; surface: null }
  | { kind: "surface"; group: ThemeGroup; surface: ThemeToken }

function toSurface(token: ThemeToken): ThemeSurface {
  return {
    id: token.id,
    label: token.label,
    targets: token.targets,
    cssVar: token.cssVar,
    groupId: token.groupId,
  }
}

export function surfaceById(id: string): ThemeSurface | null {
  const token = tokenById(id)
  return token ? toSurface(token) : null
}

export function surfaceByTarget(target: string): ThemeSurface | null {
  const token = tokenByTarget(target)
  return token ? toSurface(token) : null
}

export function targetsSharingCssVar(cssVar: string): string[] {
  return THEME_TOKENS.filter((token) => token.cssVar === cssVar).flatMap(
    (token) => token.targets
  )
}

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

export function queryGroupHosts(groupId: string): Element[] {
  if (typeof document === "undefined") return []
  return [
    ...document.querySelectorAll(`[data-theme-group="${CSS.escape(groupId)}"]`),
  ]
}

function groupFromEl(el: Element): ThemeGroup | null {
  const id = el.getAttribute("data-theme-group")
  return id ? groupById(id) : null
}

/**
 * Closest registered theme hit (buttons inside a region still pick that region
 * when they have no surface of their own). Ignores magic chrome.
 */
export function resolveThemeHit(el: Element | null): ThemeHit | null {
  if (!el || typeof el.closest !== "function") return null
  if (el.closest("[data-magic-chrome]")) return null

  let host: Element | null = el.closest(
    "[data-theme-target], [data-theme-group]"
  )
  while (host) {
    if (host.closest("[data-magic-chrome]")) return null
    const target = host.getAttribute("data-theme-target")
    const token = target ? tokenByTarget(target) : null
    if (token) {
      const group = groupById(token.groupId)
      if (group) return { kind: "surface", group, surface: token }
    }
    const group = groupFromEl(host)
    if (group) return { kind: "group", group, surface: null }
    const parent = host.parentElement
    host = parent?.closest("[data-theme-target], [data-theme-group]") ?? null
  }
  return null
}

export function resolveThemeHitAtPoint(x: number, y: number): ThemeHit | null {
  if (typeof document === "undefined") return null
  const stack = document.elementsFromPoint(x, y)
  for (const el of stack) {
    if (!el || typeof (el as Element).closest !== "function") continue
    if ((el as Element).closest("[data-magic-chrome]")) continue
    const hit = resolveThemeHit(el as Element)
    if (hit) return hit
  }
  return null
}
