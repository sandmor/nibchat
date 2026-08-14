import { z } from "zod"
import {
  COMPILED_ALIASES,
  extraPaletteVar,
  groupFillVar,
  isColorValue,
  isPaletteRole,
  isThemeGroupId,
  PALETTE_ROLES,
  THEME_GROUPS,
  THEME_TOKENS,
  tokenByCssVar,
  type ColorValue,
  type PaletteRole,
  type ThemeGroupId,
} from "@/lib/appearance-registry"

export const PAPER_THEME_ID = "paper"
export const INK_THEME_ID = "ink"
export const SPATIAL_THEME_ID = "spatial"
export const EDITORIAL_THEME_ID = "editorial"

export const motionSchema = z
  .object({
    enabled: z.boolean().default(true),
    durationMs: z.number().min(0).max(2000).default(220),
    ease: z
      .union([
        z.tuple([z.number(), z.number(), z.number(), z.number()]),
        z.string(),
      ])
      .default([0.22, 1, 0.36, 1]),
    reducedMotion: z.enum(["respect", "never", "always"]).default("respect"),
  })
  .default({
    enabled: true,
    durationMs: 220,
    ease: [0.22, 1, 0.36, 1],
    reducedMotion: "respect",
  })

export type AppearanceMotion = z.infer<typeof motionSchema>

export const messageActionsSchema = z
  .object({
    captions: z.boolean().default(false),
  })
  .default({ captions: false })

export type AppearanceMessageActions = z.infer<typeof messageActionsSchema>

export const modelPickerSchema = z
  .object({
    showIds: z.boolean().default(false),
  })
  .default({ showIds: false })

export type AppearanceModelPicker = z.infer<typeof modelPickerSchema>

const colorValueSchema: z.ZodType<ColorValue> = z.lazy(() =>
  z.union([
    z.object({
      ref: z.string().min(1),
      alpha: z.number().min(0).max(1).optional(),
    }),
    z.object({
      mix: z.object({
        from: colorValueSchema,
        onto: colorValueSchema,
        amount: z.number().min(0).max(1),
      }),
      alpha: z.number().min(0).max(1).optional(),
    }),
    z.object({
      literal: z.string().min(1),
      alpha: z.number().min(0).max(1).optional(),
    }),
  ])
)

export const paletteExtraSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(80).optional(),
  value: z.string().min(1),
})

export type PaletteExtra = z.infer<typeof paletteExtraSchema>

export const paletteSchema = z.object({
  paper: z.string().min(1),
  ink: z.string().min(1),
  muted: z.string().min(1),
  accent: z.string().min(1),
  danger: z.string().min(1),
  extras: z.array(paletteExtraSchema).default([]),
})

export type AppearancePalette = z.infer<typeof paletteSchema>

export const groupPaintSchema = z.object({
  fill: colorValueSchema.optional(),
  recolorText: z.boolean().optional(),
})

export type GroupPaint = z.infer<typeof groupPaintSchema>

export const APPEARANCE_VERSION = 1 as const

const appearanceBaseSchema = z
  .object({
    version: z.literal(APPEARANCE_VERSION).default(APPEARANCE_VERSION),
    scheme: z.enum(["light", "dark"]).default("light"),
    density: z.enum(["comfortable", "compact"]).default("comfortable"),
    radius: z.string().min(1).default("0.625rem"),
    remoteStylesheet: z.string().optional(),
    motion: motionSchema,
    messageActions: messageActionsSchema,
    modelPicker: modelPickerSchema,
    palette: paletteSchema,
    groups: z.record(z.string(), groupPaintSchema).default({}),
    tokens: z.record(z.string(), colorValueSchema).default({}),
  })
  .loose()

export type Appearance = z.infer<typeof appearanceBaseSchema>

export type AppearanceReferenceIssue = {
  path: (string | number)[]
  message: string
}

/** Validate graph references so editor documents cannot produce CSS cycles. */
export function appearanceReferenceIssues(
  doc: Appearance
): AppearanceReferenceIssue[] {
  const issues: AppearanceReferenceIssue[] = []
  const extras = new Set(doc.palette.extras.map((extra) => extra.id))

  function issue(path: (string | number)[], message: string) {
    issues.push({ path, message })
  }

  function visit(
    value: ColorValue,
    path: (string | number)[],
    stack: string[]
  ): void {
    if ("literal" in value) return
    if ("mix" in value) {
      visit(value.mix.from, [...path, "mix", "from"], stack)
      visit(value.mix.onto, [...path, "mix", "onto"], stack)
      return
    }
    if (isPaletteRole(value.ref)) return
    if (value.ref.startsWith("extra:")) {
      if (!extras.has(value.ref.slice(6))) {
        issue(path, `Unknown palette extra: ${value.ref}`)
      }
      return
    }
    if (!value.ref.startsWith("group:")) {
      issue(path, `Unknown color reference: ${value.ref}`)
      return
    }
    const groupId = value.ref.slice(6)
    if (!isThemeGroupId(groupId)) {
      issue(path, `Unknown theme group: ${groupId}`)
      return
    }
    if (stack.includes(groupId)) {
      issue(
        path,
        `Theme group reference cycle: ${[...stack, groupId].join(" → ")}`
      )
      return
    }
    const fill = doc.groups[groupId]?.fill
    if (fill) visit(fill, ["groups", groupId, "fill"], [...stack, groupId])
  }

  for (const [groupId, paint] of Object.entries(doc.groups)) {
    if (paint.fill) visit(paint.fill, ["groups", groupId, "fill"], [groupId])
  }
  for (const [cssVar, value] of Object.entries(doc.tokens)) {
    visit(value, ["tokens", cssVar], [])
  }
  return issues
}

export const appearanceSchema = appearanceBaseSchema.superRefine((doc, ctx) => {
  for (const problem of appearanceReferenceIssues(doc)) {
    ctx.addIssue({
      code: "custom",
      path: problem.path,
      message: problem.message,
    })
  }
})

export type ThemeRecord = {
  id: string
  name: string
  document: Appearance
  created_at: string
  updated_at: string
}

const defaultMotion: AppearanceMotion = {
  enabled: true,
  durationMs: 220,
  ease: [0.22, 1, 0.36, 1],
  reducedMotion: "respect",
}

export const PAPER_PALETTE: AppearancePalette = {
  paper: "oklch(1 0 0)",
  ink: "oklch(0.145 0 0)",
  muted: "oklch(0.556 0 0)",
  accent: "oklch(0.205 0 0)",
  danger: "oklch(0.577 0.245 27.325)",
  extras: [],
}

export const INK_PALETTE: AppearancePalette = {
  paper: "oklch(0.145 0 0)",
  ink: "oklch(0.985 0 0)",
  muted: "oklch(0.708 0 0)",
  accent: "oklch(0.922 0 0)",
  danger: "oklch(0.704 0.191 22.216)",
  extras: [],
}

export const SPATIAL_PALETTE: AppearancePalette = {
  paper: "oklch(0.96 0.012 85)",
  ink: "oklch(0.25 0.02 75)",
  muted: "oklch(0.45 0.02 75)",
  accent: "oklch(0.53 0.16 170)",
  danger: "oklch(0.577 0.245 27.325)",
  extras: [],
}

export const EDITORIAL_PALETTE: AppearancePalette = {
  paper: "oklch(0.975 0.012 70)",
  ink: "oklch(0.18 0.025 35)",
  muted: "oklch(0.45 0.02 40)",
  accent: "oklch(0.42 0.16 25)",
  danger: "oklch(0.577 0.245 27.325)",
  extras: [],
}

const cssEaseCurves: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
}

/** Convert the CSS easing syntax accepted by appearance JSON into Motion. */
export function motionEase(
  ease: AppearanceMotion["ease"]
): [number, number, number, number] {
  if (Array.isArray(ease)) return ease
  const named = cssEaseCurves[ease.trim().toLowerCase()]
  if (named) return named
  const match = ease.match(/^cubic-bezier\(([^)]+)\)$/i)
  if (!match) return defaultMotion.ease as [number, number, number, number]
  const values = match[1]!.split(",").map((value) => Number(value.trim()))
  if (
    values.length !== 4 ||
    values.some((value) => !Number.isFinite(value)) ||
    values[0]! < 0 ||
    values[0]! > 1 ||
    values[2]! < 0 ||
    values[2]! > 1
  )
    return defaultMotion.ease as [number, number, number, number]
  return values as [number, number, number, number]
}

function easeToCss(ease: AppearanceMotion["ease"]): string {
  return `cubic-bezier(${motionEase(ease).join(", ")})`
}

function motionVars(motion: AppearanceMotion): Record<string, string> {
  if (!motion.enabled) {
    return {
      "--motion-duration": "0ms",
      "--motion-ease": "linear",
    }
  }
  return {
    "--motion-duration": `${motion.durationMs}ms`,
    "--motion-ease": easeToCss(motion.ease),
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function omitNullFields(
  value: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null) continue
    out[key] = isPlainObject(entry) ? omitNullFields(entry) : entry
  }
  return out
}

function parsePalette(value: unknown): AppearancePalette {
  const base = { ...PAPER_PALETTE, extras: [] as PaletteExtra[] }
  if (!isPlainObject(value)) return base
  const extrasRaw = Array.isArray(value.extras) ? value.extras : []
  const extras: PaletteExtra[] = []
  for (const extra of extrasRaw) {
    if (!isPlainObject(extra)) continue
    if (typeof extra.id !== "string" || typeof extra.value !== "string")
      continue
    extras.push({
      id: extra.id,
      value: extra.value,
      ...(typeof extra.name === "string" ? { name: extra.name } : {}),
    })
  }
  return {
    paper: typeof value.paper === "string" ? value.paper : base.paper,
    ink: typeof value.ink === "string" ? value.ink : base.ink,
    muted: typeof value.muted === "string" ? value.muted : base.muted,
    accent: typeof value.accent === "string" ? value.accent : base.accent,
    danger: typeof value.danger === "string" ? value.danger : base.danger,
    extras,
  }
}

function parseGroups(value: unknown): Record<string, GroupPaint> {
  if (!isPlainObject(value)) return {}
  const out: Record<string, GroupPaint> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!isThemeGroupId(key) || !isPlainObject(entry)) continue
    const paint: GroupPaint = {}
    if (isColorValue(entry.fill)) paint.fill = entry.fill
    if (typeof entry.recolorText === "boolean")
      paint.recolorText = entry.recolorText
    if (paint.fill || paint.recolorText) out[key] = paint
  }
  return out
}

function parseTokens(value: unknown): Record<string, ColorValue> {
  if (!isPlainObject(value)) return {}
  const out: Record<string, ColorValue> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!isColorValue(entry)) continue
    out[key] = entry
  }
  return out
}

export function defaultAppearance(): Appearance {
  return appearanceSchema.parse({
    version: APPEARANCE_VERSION,
    scheme: "light",
    density: "comfortable",
    radius: "0.625rem",
    motion: { ...defaultMotion },
    palette: { ...PAPER_PALETTE, extras: [] },
    groups: {},
    tokens: {},
  })
}

/** Normalize a document into the canonical appearance shape. */
export function parseAppearance(value: unknown): Appearance {
  if (!isPlainObject(value)) return defaultAppearance()
  const raw = omitNullFields(value)
  raw.version = APPEARANCE_VERSION
  if (raw.scheme !== "dark") raw.scheme = "light"
  if (raw.density !== "compact") raw.density = "comfortable"
  if (typeof raw.radius !== "string" || !raw.radius.trim()) {
    raw.radius = "0.625rem"
  }
  if (typeof raw.remoteStylesheet === "string") {
    const trimmed = raw.remoteStylesheet.trim()
    if (trimmed) raw.remoteStylesheet = trimmed
    else delete raw.remoteStylesheet
  } else {
    delete raw.remoteStylesheet
  }
  raw.palette = parsePalette(raw.palette)
  raw.groups = parseGroups(raw.groups)
  raw.tokens = parseTokens(raw.tokens)
  return appearanceSchema.parse(raw)
}

export function cssForColor(value: ColorValue): string {
  let base: string
  if ("literal" in value) {
    base = value.literal
  } else if ("mix" in value) {
    const pct = Math.round(value.mix.amount * 1000) / 10
    base = `color-mix(in oklab, ${cssForColor(value.mix.from)} ${pct}%, ${cssForColor(value.mix.onto)})`
  } else {
    base = cssForRef(value.ref)
  }
  if (value.alpha != null && value.alpha < 1) {
    const pct = Math.round(value.alpha * 1000) / 10
    return `color-mix(in oklab, ${base} ${pct}%, transparent)`
  }
  return base
}

function cssForRef(refValue: string): string {
  if (refValue.startsWith("extra:")) {
    return `var(${extraPaletteVar(refValue.slice(6))})`
  }
  if (refValue.startsWith("group:")) {
    const groupId = refValue.slice(6)
    if (isThemeGroupId(groupId)) return `var(${groupFillVar(groupId)})`
  }
  if (isPaletteRole(refValue)) return `var(--palette-${refValue})`
  return "var(--palette-paper)"
}

function resolvedTokenValue(
  doc: Appearance,
  cssVar: `--${string}`
): ColorValue {
  const override = doc.tokens[cssVar]
  if (override) return override
  const token = tokenByCssVar(cssVar)
  if (!token) return { literal: "oklch(0.5 0 0)" }
  const groupPaint = doc.groups[token.groupId]
  if (token.role === "fill") {
    if (groupPaint?.fill) return { ref: `group:${token.groupId}` }
    return token.recipe
  }
  if (token.role === "foreground" && groupPaint?.recolorText) {
    return { ref: `group:${token.groupId}` }
  }
  return token.recipe
}

function resolvedGroupFill(doc: Appearance, groupId: ThemeGroupId): ColorValue {
  const paint = doc.groups[groupId]?.fill
  if (paint) return paint
  const group = THEME_GROUPS.find((entry) => entry.id === groupId)
  const fillToken = group
    ? THEME_TOKENS.find((token) => token.id === group.fillTokenId)
    : undefined
  return fillToken?.recipe ?? { ref: "paper" }
}

/** Compile palette + recipes + overrides into CSS custom properties. */
export function compileAppearance(doc: Appearance): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const role of PALETTE_ROLES) {
    vars[`--palette-${role}`] = doc.palette[role]
  }
  for (const extra of doc.palette.extras) {
    vars[extraPaletteVar(extra.id)] = extra.value
  }
  for (const group of THEME_GROUPS) {
    vars[groupFillVar(group.id)] = cssForColor(resolvedGroupFill(doc, group.id))
  }
  for (const token of THEME_TOKENS) {
    vars[token.cssVar] = cssForColor(resolvedTokenValue(doc, token.cssVar))
  }
  vars["--radius"] = doc.radius
  vars["--tree-shadow-sm"] =
    "0 1px 3px color-mix(in oklab, var(--palette-ink) 12%, transparent)"
  vars["--tree-shadow-lg"] =
    "0 12px 28px -12px color-mix(in oklab, var(--palette-ink) 24%, transparent)"
  vars["--tree-shadow-xl"] =
    "0 24px 56px -20px color-mix(in oklab, var(--palette-ink) 28%, transparent)"
  vars["--motion-spinner-duration"] = "900ms"
  Object.assign(vars, motionVars(doc.motion))
  Object.assign(vars, COMPILED_ALIASES)
  return vars
}

export function appearanceToJson(doc: Appearance, pretty = true): string {
  const body: Record<string, unknown> = { ...doc }
  if (!body.remoteStylesheet) delete body.remoteStylesheet
  if (body.groups && typeof body.groups === "object") {
    const groups = body.groups as Record<string, unknown>
    if (Object.keys(groups).length === 0) delete body.groups
  }
  if (body.tokens && typeof body.tokens === "object") {
    const tokens = body.tokens as Record<string, unknown>
    if (Object.keys(tokens).length === 0) delete body.tokens
  }
  return pretty ? JSON.stringify(body, null, 2) : JSON.stringify(body)
}

export function shouldAnimate(
  motion: AppearanceMotion,
  prefersReduced: boolean
): boolean {
  if (!motion.enabled) return false
  if (motion.reducedMotion === "always") return false
  if (motion.reducedMotion === "never") return true
  return !prefersReduced
}

export function motionTransition(motion: AppearanceMotion): {
  duration: number
  ease: [number, number, number, number]
} {
  return {
    duration: motion.durationMs / 1000,
    ease: motionEase(motion.ease),
  }
}

export type SeedTheme = {
  id: string
  name: string
  description: string
  document: Appearance
}

function seedDocument(
  patch: Partial<Appearance> & { palette: AppearancePalette }
): Appearance {
  return parseAppearance({
    version: APPEARANCE_VERSION,
    scheme: "light",
    density: "comfortable",
    radius: "0.625rem",
    motion: { ...defaultMotion },
    groups: {},
    tokens: {},
    ...patch,
  })
}

export const SEED_THEMES: SeedTheme[] = [
  {
    id: PAPER_THEME_ID,
    name: "Paper",
    description: "Clean light tokens",
    document: seedDocument({ palette: PAPER_PALETTE, scheme: "light" }),
  },
  {
    id: INK_THEME_ID,
    name: "Ink",
    description: "Clean dark tokens",
    document: seedDocument({ palette: INK_PALETTE, scheme: "dark" }),
  },
  {
    id: SPATIAL_THEME_ID,
    name: "Soft spatial",
    description: "Warm paper, softer radius",
    document: seedDocument({
      palette: SPATIAL_PALETTE,
      scheme: "light",
      radius: "1.15rem",
      motion: {
        enabled: true,
        durationMs: 280,
        ease: [0.22, 1, 0.36, 1],
        reducedMotion: "respect",
      },
    }),
  },
  {
    id: EDITORIAL_THEME_ID,
    name: "Editorial",
    description: "Ink and paper, sharper corners",
    document: seedDocument({
      palette: EDITORIAL_PALETTE,
      scheme: "light",
      density: "compact",
      radius: "0.25rem",
      motion: {
        enabled: true,
        durationMs: 160,
        ease: [0.25, 0.1, 0.25, 1],
        reducedMotion: "respect",
      },
    }),
  },
]

export function patchPalette(
  doc: Appearance,
  role: PaletteRole,
  value: string
): Appearance {
  return {
    ...doc,
    palette: { ...doc.palette, [role]: value },
  }
}

export function patchGroupFill(
  doc: Appearance,
  groupId: ThemeGroupId,
  fill: ColorValue | undefined,
  recolorText?: boolean
): Appearance {
  const groups = { ...doc.groups }
  if (!fill && !recolorText) {
    delete groups[groupId]
  } else {
    groups[groupId] = {
      ...(fill ? { fill } : {}),
      ...(recolorText ? { recolorText: true } : {}),
    }
  }
  return { ...doc, groups }
}

export function patchToken(
  doc: Appearance,
  cssVar: string,
  value: ColorValue | undefined
): Appearance {
  const tokens = { ...doc.tokens }
  if (!value) delete tokens[cssVar]
  else tokens[cssVar] = value
  return { ...doc, tokens }
}

export function addPaletteExtra(
  doc: Appearance,
  extra: PaletteExtra
): Appearance {
  const extras = doc.palette.extras.filter((item) => item.id !== extra.id)
  extras.push(extra)
  return parseAppearance({
    ...doc,
    palette: { ...doc.palette, extras },
  })
}

export function patchPaletteExtra(
  doc: Appearance,
  id: string,
  patch: { value?: string; name?: string }
): Appearance {
  let found = false
  const extras = doc.palette.extras.map((extra) => {
    if (extra.id !== id) return extra
    found = true
    return {
      ...extra,
      ...(patch.value != null ? { value: patch.value } : {}),
      ...(patch.name != null ? { name: patch.name } : {}),
    }
  })
  if (!found) return doc
  return {
    ...doc,
    palette: { ...doc.palette, extras },
  }
}

export function newPaletteExtraId(doc: Appearance, name: string): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "swatch"
  const used = new Set(doc.palette.extras.map((item) => item.id))
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

function rewriteColorValue(
  value: ColorValue,
  fromRef: string,
  to: ColorValue
): ColorValue {
  if ("mix" in value) {
    return {
      mix: {
        from: rewriteColorValue(value.mix.from, fromRef, to),
        onto: rewriteColorValue(value.mix.onto, fromRef, to),
        amount: value.mix.amount,
      },
      ...(value.alpha != null ? { alpha: value.alpha } : {}),
    }
  }
  if ("ref" in value && value.ref === fromRef) {
    return value.alpha != null ? { ...to, alpha: value.alpha } : to
  }
  return value
}

/** Drop an extra and turn leftover `extra:id` refs into literals so the look holds. */
export function removePaletteExtra(doc: Appearance, id: string): Appearance {
  const extra = doc.palette.extras.find((item) => item.id === id)
  if (!extra) return doc
  const extras = doc.palette.extras.filter((item) => item.id !== id)
  const fallback: ColorValue = { literal: extra.value }
  const fromRef = `extra:${id}`
  const groups = Object.fromEntries(
    Object.entries(doc.groups).map(([groupId, paint]) => [
      groupId,
      {
        ...paint,
        ...(paint.fill
          ? { fill: rewriteColorValue(paint.fill, fromRef, fallback) }
          : {}),
      },
    ])
  )
  const tokens = Object.fromEntries(
    Object.entries(doc.tokens).map(([cssVar, value]) => [
      cssVar,
      rewriteColorValue(value, fromRef, fallback),
    ])
  )
  return parseAppearance({
    ...doc,
    palette: { ...doc.palette, extras },
    groups,
    tokens,
  })
}
