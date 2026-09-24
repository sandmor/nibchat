import { z } from "zod"
import {
  appearanceSchema,
  parseAppearance,
  type Appearance,
  type ThemeRecord,
} from "@/lib/appearance"
import { isThemeGroupId, tokenByCssVar } from "@/lib/appearance-registry"
import { policyModeSchema } from "@/lib/chat-settings/policy"
import type { SpaceRecord } from "@/lib/spaces/tree"

const themePolicySchema = z.object({
  mode: policyModeSchema,
  value: z.string().min(1),
})
export const appearancePatchSchema = z
  .object({
    reset: z.boolean().optional(),
    values: z.record(z.string(), z.unknown()).optional(),
    policies: z.record(z.string().startsWith("/"), policyModeSchema).optional(),
  })
  .strict()

export const spaceAppearanceSchema = z
  .object({
    lightTheme: themePolicySchema.optional(),
    darkTheme: themePolicySchema.optional(),
    shared: appearancePatchSchema.optional(),
    light: appearancePatchSchema.optional(),
    dark: appearancePatchSchema.optional(),
  })
  .strict()

export type SpaceAppearance = z.infer<typeof spaceAppearanceSchema>
export type AppearancePatch = z.infer<typeof appearancePatchSchema>

type Entry = { value: unknown; mode: "default" | "require" | "release" }

function pointer(path: readonly string[]) {
  return `/${path.map((part) => part.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`
}

export function flattenAppearancePatch(
  value: Record<string, unknown>,
  path: string[] = []
): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = []
  for (const [key, child] of Object.entries(value)) {
    const next = [...path, key]
    const atomic =
      Array.isArray(child) ||
      child === null ||
      typeof child !== "object" ||
      path[0] === "tokens" ||
      (path[0] === "groups" && next.at(-1) === "fill") ||
      (path[0] === "palette" && key === "extras")
    if (atomic) out.push([pointer(next), child])
    else
      out.push(
        ...flattenAppearancePatch(child as Record<string, unknown>, next)
      )
  }
  return out
}

function applyPatch(
  target: Map<string, Entry>,
  patch: AppearancePatch | undefined
) {
  if (!patch) return
  if (patch.reset) target.clear()
  const values = new Map(flattenAppearancePatch(patch.values ?? {}))
  const paths = new Set([
    ...values.keys(),
    ...Object.keys(patch.policies ?? {}),
  ])
  for (const path of paths) {
    const mode = patch.policies?.[path] ?? "default"
    if (mode === "release") target.set(path, { mode, value: undefined })
    else if (values.has(path))
      target.set(path, { mode, value: values.get(path) })
  }
}

function pathSegments(path: string) {
  return path
    .slice(1)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
}

function validPath(path: string): boolean {
  if (!path.startsWith("/") || path === "/") return false
  const parts = pathSegments(path)
  if (
    parts.some(
      (part) =>
        !part || ["__proto__", "prototype", "constructor"].includes(part)
    )
  )
    return false
  const [root, second, third] = parts
  if (["scheme", "density", "radius", "remoteStylesheet"].includes(root!))
    return parts.length === 1
  if (root === "motion")
    return (
      parts.length === 2 &&
      ["enabled", "durationMs", "ease", "reducedMotion"].includes(second!)
    )
  if (root === "messageActions")
    return parts.length === 2 && second === "captions"
  if (root === "modelPicker") return parts.length === 2 && second === "showIds"
  if (root === "messageLayout")
    return (
      parts.length === 3 &&
      ["user", "assistant"].includes(second!) &&
      ["align", "maxWidthPercent"].includes(third!)
    )
  if (root === "palette")
    return (
      parts.length === 2 &&
      ["paper", "ink", "muted", "accent", "danger", "extras"].includes(second!)
    )
  if (root === "groups")
    return (
      parts.length === 3 &&
      isThemeGroupId(second!) &&
      ["fill", "recolorText"].includes(third!)
    )
  if (root === "tokens")
    return parts.length === 2 && Boolean(tokenByCssVar(second!))
  return false
}

export function assertAppearancePatch(patch: AppearancePatch | undefined) {
  if (!patch) return
  const valuePaths = new Set(
    flattenAppearancePatch(patch.values ?? {}).map(([path]) => path)
  )
  for (const path of valuePaths) {
    if (!validPath(path)) throw new Error(`Invalid appearance path: ${path}`)
  }
  for (const [path, mode] of Object.entries(patch.policies ?? {})) {
    if (!validPath(path))
      throw new Error(`Invalid appearance policy path: ${path}`)
    if (mode !== "release" && !valuePaths.has(path))
      throw new Error(`Set a value before applying ${mode} to ${path}`)
  }
}

function assignPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown
) {
  const segments = pathSegments(path)
  let cursor = target
  for (const part of segments.slice(0, -1)) {
    const next = cursor[part]
    if (!next || typeof next !== "object" || Array.isArray(next))
      cursor[part] = {}
    cursor = cursor[part] as Record<string, unknown>
  }
  const key = segments.at(-1)!
  if (value === null) delete cursor[key]
  else cursor[key] = value
}

function chooseTheme(
  chain: readonly SpaceRecord[],
  slot: "light" | "dark",
  userThemeId: string
) {
  const key = slot === "light" ? "lightTheme" : "darkTheme"
  let id = userThemeId
  for (const space of chain) {
    const policy = space.settings.appearance?.[key]
    if (!policy) continue
    id = policy.mode === "release" ? userThemeId : policy.value
  }
  return id
}

/** Resolve one workspace appearance without mutating a library document. */
export function resolveSpaceAppearance(input: {
  spaceId?: string | null
  spaces: readonly SpaceRecord[]
  slot: "light" | "dark"
  userThemeId: string
  themes: readonly ThemeRecord[]
  strict?: boolean
}): { themeId: string; document: Appearance } {
  const byId = new Map(input.spaces.map((space) => [space.id, space]))
  const chain: SpaceRecord[] = []
  const seen = new Set<string>()
  let current = input.spaceId ? byId.get(input.spaceId) : undefined
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.unshift(current)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  const chosenId = chooseTheme(chain, input.slot, input.userThemeId)
  const theme =
    input.themes.find((item) => item.id === chosenId) ??
    input.themes.find((item) => item.id === input.userThemeId) ??
    input.themes[0]
  const base = theme?.document ?? parseAppearance({})
  const shared = new Map<string, Entry>()
  const specific = new Map<string, Entry>()
  for (const space of chain)
    applyPatch(shared, space.settings.appearance?.shared)
  for (const space of chain)
    applyPatch(specific, space.settings.appearance?.[input.slot])
  const merged = structuredClone(base) as Record<string, unknown>
  const required = new Set<string>()
  for (const [path, entry] of shared) {
    if (entry.mode === "require") required.add(path)
    if (entry.mode !== "release") assignPath(merged, path, entry.value)
  }
  for (const [path, entry] of specific) {
    if (required.has(path)) continue
    if (entry.mode === "release") {
      const baseValues = new Map(
        flattenAppearancePatch(base as Record<string, unknown>)
      )
      if (baseValues.has(path)) assignPath(merged, path, baseValues.get(path))
      else assignPath(merged, path, null)
    } else assignPath(merged, path, entry.value)
  }
  const result = appearanceSchema.safeParse(merged)
  if (!result.success && input.strict) {
    throw new Error(
      result.error.issues[0]?.message ?? "Invalid appearance override"
    )
  }
  return {
    themeId: theme?.id ?? input.userThemeId,
    document: result.success ? result.data : base,
  }
}
