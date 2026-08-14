import { z } from "zod"

/**
 * Appearance is a free-form JSON document. The app only *reads* known fields.
 * Starters overlay the current document, then parse into the same canonical
 * shape the editor saves — never a patch, and never `null` after parse.
 */
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
    /** When true, footer actions show text next to icons. When false, icons only (+ tooltip). */
    captions: z.boolean().default(false),
  })
  .default({ captions: false })

export type AppearanceMessageActions = z.infer<typeof messageActionsSchema>

export const modelPickerSchema = z
  .object({
    /** When true, show API model ids in chat chrome. Hidden outside Settings by default. */
    showIds: z.boolean().default(false),
  })
  .default({ showIds: false })

export type AppearanceModelPicker = z.infer<typeof modelPickerSchema>

export const appearanceSchema = z
  .object({
    version: z.literal(1).default(1),
    /** Spacing scale used by the shell (any document may set this). */
    density: z.enum(["comfortable", "compact"]).default("comfortable"),
    /** Optional external stylesheet; loaded after CSS vars. */
    remoteStylesheet: z.string().optional(),
    /**
     * CSS custom properties applied to :root. This is the visual source of
     * truth — not a overlay on a named theme.
     */
    vars: z.record(z.string(), z.string()).default({}),
    /** Motion / transition tokens consumed by the shell. */
    motion: motionSchema,
    /** Message chrome (footer actions, etc.). */
    messageActions: messageActionsSchema,
    /** Chat model selector chrome. */
    modelPicker: modelPickerSchema,
  })
  .loose()

export type Appearance = z.infer<typeof appearanceSchema>

const defaultVars: Record<string, string> = {
  "--background": "oklch(1 0 0)",
  "--foreground": "oklch(0.145 0 0)",
  "--card": "oklch(1 0 0)",
  "--card-foreground": "oklch(0.145 0 0)",
  "--popover": "oklch(1 0 0)",
  "--popover-foreground": "oklch(0.145 0 0)",
  "--primary": "oklch(0.205 0 0)",
  "--primary-foreground": "oklch(0.985 0 0)",
  "--secondary": "oklch(0.97 0 0)",
  "--secondary-foreground": "oklch(0.205 0 0)",
  "--muted": "oklch(0.97 0 0)",
  "--muted-foreground": "oklch(0.556 0 0)",
  "--accent": "oklch(0.97 0 0)",
  "--accent-foreground": "oklch(0.205 0 0)",
  "--border": "oklch(0.922 0 0)",
  "--input": "oklch(0.922 0 0)",
  "--radius": "0.625rem",
  "--sidebar": "oklch(0.985 0 0)",
  "--sidebar-foreground": "oklch(0.145 0 0)",
  "--sidebar-primary": "oklch(0.205 0 0)",
  "--sidebar-primary-foreground": "oklch(0.985 0 0)",
  "--sidebar-accent": "oklch(0.97 0 0)",
  "--sidebar-accent-foreground": "oklch(0.205 0 0)",
  "--sidebar-border": "oklch(0.922 0 0)",
  "--tree-grid-color":
    "color-mix(in oklab, var(--muted-foreground) 18%, transparent)",
  "--tree-edge-color": "var(--border)",
  "--tree-active-color": "color-mix(in oklab, var(--primary) 70%, transparent)",
  "--tree-focus-color": "color-mix(in oklab, var(--primary) 70%, transparent)",
  "--tree-path-color": "color-mix(in oklab, var(--primary) 35%, transparent)",
  "--tree-active-surface":
    "color-mix(in oklab, var(--primary) 20%, transparent)",
  "--tree-chrome-background":
    "color-mix(in oklab, var(--background) 90%, transparent)",
  "--tree-overlay-background":
    "color-mix(in oklab, var(--background) 45%, transparent)",
  // One token per minimap paint. Defaults stay derived from semantic tokens;
  // a picker write to that key snapshots it to oklch.
  "--tree-minimap-background": "var(--muted)",
  "--tree-minimap-edge":
    "color-mix(in oklab, var(--muted-foreground) 80%, var(--muted))",
  "--tree-minimap-node": "var(--muted-foreground)",
  "--tree-minimap-path":
    "color-mix(in oklab, var(--primary) 82%, var(--muted-foreground))",
  "--tree-minimap-focus": "var(--primary)",
  "--tree-viewport-color": "var(--foreground)",
  "--tree-shadow-sm":
    "0 1px 3px color-mix(in oklab, var(--foreground) 12%, transparent)",
  "--tree-shadow-lg":
    "0 12px 28px -12px color-mix(in oklab, var(--foreground) 24%, transparent)",
  "--tree-shadow-xl":
    "0 24px 56px -20px color-mix(in oklab, var(--foreground) 28%, transparent)",
  "--motion-duration": "220ms",
  "--motion-ease": "cubic-bezier(0.22, 1, 0.36, 1)",
  "--motion-spinner-duration": "900ms",
}

const defaultMotion: AppearanceMotion = {
  enabled: true,
  durationMs: 220,
  ease: [0.22, 1, 0.36, 1],
  reducedMotion: "respect",
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

/** Drop `null` fields. `null` is a delete verb, never a stored token. */
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

/**
 * Overlay a starter onto a document. Omitted keys stay. `null` deletes.
 * `vars` merges per token; every other object value replaces.
 */
export function overlayAppearance(
  base: unknown,
  patch: unknown
): Record<string, unknown> {
  const root = isPlainObject(base) ? { ...base } : {}
  if (!isPlainObject(patch)) return root
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete root[key]
      continue
    }
    if (key === "vars" && isPlainObject(value)) {
      const currentVars = isPlainObject(root.vars) ? { ...root.vars } : {}
      for (const [token, tokenValue] of Object.entries(value)) {
        if (tokenValue === null) delete currentVars[token]
        else currentVars[token] = tokenValue
      }
      root.vars = currentVars
      continue
    }
    root[key] = value
  }
  return root
}

/** Apply a starter and return the canonical document the editor should show. */
export function applyAppearancePreset(
  current: Appearance,
  patch: unknown
): Appearance {
  return parseAppearance(overlayAppearance(current, patch))
}

/**
 * Starter overlays. `null` means delete that key (or token) when applied.
 * Omitted chrome (`messageActions`, `modelPicker`, extra vars) is left on the
 * current document.
 */
export const presetTemplates = {
  default: {
    name: "Default",
    description: "Clean white tokens",
    document: {
      version: 1 as const,
      density: "comfortable" as const,
      vars: null,
      remoteStylesheet: null,
      motion: { ...defaultMotion },
    },
  },
  spatial: {
    name: "Soft spatial",
    description: "Warm paper tokens, softer radius",
    document: {
      version: 1 as const,
      density: "comfortable" as const,
      motion: {
        enabled: true,
        durationMs: 280,
        ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
        reducedMotion: "respect" as const,
      },
      vars: {
        "--background": "oklch(.96 .012 85)",
        "--foreground": "oklch(.25 .02 75)",
        "--card": "oklch(.99 .008 85)",
        "--card-foreground": "oklch(.25 .02 75)",
        "--popover": "oklch(.99 .008 85)",
        "--popover-foreground": "oklch(.25 .02 75)",
        "--primary": "oklch(.53 .16 170)",
        "--primary-foreground": "oklch(.98 .01 170)",
        "--secondary": "oklch(.94 .015 85)",
        "--secondary-foreground": "oklch(.25 .02 75)",
        "--muted": "oklch(.94 .01 85)",
        "--muted-foreground": "oklch(.45 .02 75)",
        "--accent": "oklch(.93 .02 85)",
        "--accent-foreground": "oklch(.25 .02 75)",
        "--radius": "1.15rem",
        "--border": "oklch(.82 .025 85)",
        "--input": "oklch(.82 .025 85)",
        "--sidebar": "oklch(.985 .008 85)",
        "--sidebar-foreground": "oklch(.25 .02 75)",
        "--sidebar-primary": "oklch(.53 .16 170)",
        "--sidebar-primary-foreground": "oklch(.98 .01 170)",
        "--sidebar-accent": "oklch(.94 .01 85)",
        "--sidebar-accent-foreground": "oklch(.25 .02 75)",
        "--sidebar-border": "oklch(.82 .025 85)",
      },
    },
  },
  editorial: {
    name: "Editorial",
    description: "Ink and paper, sharper corners",
    document: {
      version: 1 as const,
      density: "compact" as const,
      motion: {
        enabled: true,
        durationMs: 160,
        ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number],
        reducedMotion: "respect" as const,
      },
      vars: {
        "--background": "oklch(.975 .012 70)",
        "--foreground": "oklch(.18 .025 35)",
        "--card": "oklch(1 .005 70)",
        "--card-foreground": "oklch(.18 .025 35)",
        "--popover": "oklch(1 .005 70)",
        "--popover-foreground": "oklch(.18 .025 35)",
        "--primary": "oklch(.42 .16 25)",
        "--primary-foreground": "oklch(.98 .01 70)",
        "--secondary": "oklch(.95 .012 70)",
        "--secondary-foreground": "oklch(.18 .025 35)",
        "--muted": "oklch(.94 .01 70)",
        "--muted-foreground": "oklch(.45 .02 40)",
        "--accent": "oklch(.93 .02 70)",
        "--accent-foreground": "oklch(.18 .025 35)",
        "--radius": ".25rem",
        "--border": "oklch(.72 .03 60)",
        "--input": "oklch(.72 .03 60)",
        "--sidebar": "oklch(.99 .006 70)",
        "--sidebar-foreground": "oklch(.18 .025 35)",
        "--sidebar-primary": "oklch(.42 .16 25)",
        "--sidebar-primary-foreground": "oklch(.98 .01 70)",
        "--sidebar-accent": "oklch(.95 .012 70)",
        "--sidebar-accent-foreground": "oklch(.18 .025 35)",
        "--sidebar-border": "oklch(.72 .03 60)",
      },
    },
  },
} as const

export type PresetId = keyof typeof presetTemplates
export const PRESET_IDS = Object.keys(presetTemplates) as PresetId[]

export function defaultAppearance(): Appearance {
  return parseAppearance(presetTemplates.default.document)
}

export function presetDocument(id: PresetId): Appearance {
  return applyAppearancePreset(
    defaultAppearance(),
    presetTemplates[id].document
  )
}

/** Normalize a document into the canonical appearance shape. */
export function parseAppearance(value: unknown): Appearance {
  if (!isPlainObject(value)) return defaultAppearance()
  const raw = omitNullFields(value)

  const vars = isPlainObject(raw.vars)
    ? (raw.vars as Record<string, string>)
    : null
  raw.vars = vars && Object.keys(vars).length > 0 ? vars : { ...defaultVars }
  raw.version = 1
  if (raw.density !== "compact") raw.density = "comfortable"
  if (typeof raw.remoteStylesheet === "string") {
    const trimmed = raw.remoteStylesheet.trim()
    if (trimmed) raw.remoteStylesheet = trimmed
    else delete raw.remoteStylesheet
  } else {
    delete raw.remoteStylesheet
  }

  const parsed = appearanceSchema.parse(raw)
  const mv = motionVars(parsed.motion)
  return {
    ...parsed,
    vars: { ...parsed.vars, ...mv },
  }
}

export type ResolvedAppearance = Appearance

export function appearanceToJson(doc: Appearance, pretty = true): string {
  const body: Record<string, unknown> = { ...doc }
  if (!body.remoteStylesheet) delete body.remoteStylesheet
  if (body.vars && typeof body.vars === "object") {
    body.vars = { ...(body.vars as Record<string, string>) }
  }
  return pretty ? JSON.stringify(body, null, 2) : JSON.stringify(body)
}

/** Whether shell animations should run given document + system preference. */
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
