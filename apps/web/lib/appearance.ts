import { z } from "zod"

/**
 * Appearance is a free-form JSON document. The app only *reads* known fields;
 * presets are starter documents with the same shape — never special-cased at
 * runtime for layout or tokens.
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
  "--motion-duration": "220ms",
  "--motion-ease": "cubic-bezier(0.22, 1, 0.36, 1)",
}

const defaultMotion: AppearanceMotion = {
  enabled: true,
  durationMs: 220,
  ease: [0.22, 1, 0.36, 1],
  reducedMotion: "respect",
}

const defaultMessageActions: AppearanceMessageActions = {
  captions: false,
}

function easeToCss(ease: AppearanceMotion["ease"]): string {
  if (typeof ease === "string") return ease
  return `cubic-bezier(${ease.join(", ")})`
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

/** Named starter documents only — selecting one copies this JSON as-is. */
export const presetTemplates = {
  default: {
    name: "Default",
    description: "Clean white tokens",
    document: {
      version: 1 as const,
      density: "comfortable" as const,
      vars: { ...defaultVars },
      motion: { ...defaultMotion },
      messageActions: { ...defaultMessageActions },
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
      messageActions: { ...defaultMessageActions },
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
      messageActions: { ...defaultMessageActions },
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
  return parseAppearance(presetTemplates[id].document)
}

/** Normalize a document into the canonical appearance shape. */
export function parseAppearance(value: unknown): Appearance {
  if (!value || typeof value !== "object") return defaultAppearance()
  const raw = { ...(value as Record<string, unknown>) }

  const vars =
    raw.vars && typeof raw.vars === "object" && !Array.isArray(raw.vars)
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
  const ease: [number, number, number, number] = Array.isArray(motion.ease)
    ? motion.ease
    : [0.22, 1, 0.36, 1]
  return {
    duration: motion.durationMs / 1000,
    ease,
  }
}
