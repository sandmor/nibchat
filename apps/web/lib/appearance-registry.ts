/**
 * Theme token registry: groups, pickable surfaces, and a shared surface ramp.
 *
 * Palette seeds (paper/ink/…) feed named steps (canvas → overlay). Tokens bind
 * to a step, a palette role, or derived chrome (border/hover from the group
 * fill). Stored documents overlay group paints and token overrides on top.
 */

export const PALETTE_ROLES = [
  "paper",
  "ink",
  "muted",
  "accent",
  "danger",
] as const

export type PaletteRole = (typeof PALETTE_ROLES)[number]

export const PALETTE_ROLE_LABELS: Record<PaletteRole, string> = {
  paper: "Paper",
  ink: "Ink",
  muted: "Muted",
  accent: "Accent",
  danger: "Danger",
}

export const THEME_GROUP_IDS = [
  "app",
  "sidebar",
  "chat",
  "message-user",
  "message-assistant",
  "composer",
  "tree",
  "settings",
  "popover",
  "input",
  "button",
  "danger",
] as const

export type ThemeGroupId = (typeof THEME_GROUP_IDS)[number]

export type ColorRef = {
  ref: string
  alpha?: number
}

export type ColorMix = {
  mix: {
    from: ColorValue
    onto: ColorValue
    amount: number
  }
  alpha?: number
}

export type ColorLiteral = {
  literal: string
  alpha?: number
}

export type ColorValue = ColorRef | ColorMix | ColorLiteral

export type TokenRole =
  | "fill"
  | "foreground"
  | "border"
  | "hover"
  | "ring"
  | "other"

export const SURFACE_STEPS = [
  "canvas",
  "raised",
  "emphasis",
  "control",
  "overlay",
] as const

export type SurfaceStep = (typeof SURFACE_STEPS)[number]

export const SURFACE_STEP_LABELS: Record<SurfaceStep, string> = {
  canvas: "Canvas",
  raised: "Raised",
  emphasis: "Emphasis",
  control: "Control",
  overlay: "Overlay",
}

/**
 * Target OKLCH ΔL from canvas toward ink. Light keeps cards flush with paper;
 * dark lifts them so they separate. Chrome (line/hover) is ΔL from the local fill.
 */
export const SURFACE_DELTAS: Record<
  SurfaceStep,
  { light: number; dark: number }
> = {
  canvas: { light: 0, dark: 0 },
  raised: { light: 0, dark: 0.06 },
  emphasis: { light: 0.034, dark: 0.101 },
  control: { light: 0.068, dark: 0.126 },
  overlay: { light: 0, dark: 0.084 },
}

export const CHROME_DELTAS: Record<
  "line" | "hover",
  { light: number; dark: number }
> = {
  line: { light: 0.068, dark: 0.12 },
  hover: { light: 0.051, dark: 0.1 },
}

export type DeriveChrome = {
  kind: "derive"
  as: "line" | "hover"
  /** Default is the group fill. Canvas is for strokes that should not inherit a translucent fill. */
  onto?: "fill" | "canvas"
}

export type TokenSource = ColorValue | DeriveChrome

export type ThemeToken = {
  id: string
  label: string
  cssVar: `--${string}`
  groupId: ThemeGroupId
  role: TokenRole
  targets: string[]
  source: TokenSource
}

export type ThemeGroup = {
  id: ThemeGroupId
  label: string
  /** Host `data-theme-group` value (same as id). */
  fillTokenId: string
  foregroundTokenId?: string
}

export function isPaletteRole(value: string): value is PaletteRole {
  return (PALETTE_ROLES as readonly string[]).includes(value)
}

export function isThemeGroupId(value: string): value is ThemeGroupId {
  return (THEME_GROUP_IDS as readonly string[]).includes(value)
}

function isSurfaceStep(value: string): value is SurfaceStep {
  return (SURFACE_STEPS as readonly string[]).includes(value)
}

export function surfaceRef(step: SurfaceStep): ColorValue {
  return { ref: `surface:${step}` }
}

export function surfaceVar(step: SurfaceStep): `--${string}` {
  return `--surface-${step}`
}

export function parseSurfaceRef(value: string): SurfaceStep | null {
  if (!value.startsWith("surface:")) return null
  const step = value.slice(8)
  return isSurfaceStep(step) ? step : null
}

export function isDeriveSource(value: TokenSource): value is DeriveChrome {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "derive"
  )
}

export function ref(role: string, alpha?: number): ColorValue {
  return alpha == null ? { ref: role } : { ref: role, alpha }
}

export function mix(
  from: string | ColorValue,
  onto: string | ColorValue,
  amount: number
): ColorValue {
  const wrap = (value: string | ColorValue): ColorValue =>
    typeof value === "string" ? { ref: value } : value
  return { mix: { from: wrap(from), onto: wrap(onto), amount } }
}

export function groupFill(groupId: ThemeGroupId): ColorValue {
  return { ref: `group:${groupId}` }
}

const line: DeriveChrome = { kind: "derive", as: "line" }
const hover: DeriveChrome = { kind: "derive", as: "hover" }

export const THEME_GROUPS: ThemeGroup[] = [
  {
    id: "app",
    label: "App",
    fillTokenId: "app-background",
    foregroundTokenId: "app-foreground",
  },
  {
    id: "sidebar",
    label: "Sidebar",
    fillTokenId: "sidebar",
    foregroundTokenId: "sidebar-foreground",
  },
  { id: "chat", label: "Chat", fillTokenId: "chat" },
  {
    id: "message-user",
    label: "User message",
    fillTokenId: "message-user",
    foregroundTokenId: "message-user-foreground",
  },
  {
    id: "message-assistant",
    label: "Assistant message",
    fillTokenId: "message-assistant",
    foregroundTokenId: "message-assistant-foreground",
  },
  {
    id: "composer",
    label: "Composer",
    fillTokenId: "composer",
    foregroundTokenId: "composer-foreground",
  },
  { id: "tree", label: "Tree", fillTokenId: "tree-chrome" },
  {
    id: "settings",
    label: "Settings",
    fillTokenId: "settings-card",
    foregroundTokenId: "settings-card-foreground",
  },
  {
    id: "popover",
    label: "Popover",
    fillTokenId: "popover",
    foregroundTokenId: "popover-foreground",
  },
  { id: "input", label: "Input", fillTokenId: "input" },
  {
    id: "button",
    label: "Button",
    fillTokenId: "button",
    foregroundTokenId: "button-foreground",
  },
  {
    id: "danger",
    label: "Danger",
    fillTokenId: "danger-fill",
    foregroundTokenId: "danger",
  },
]

export const THEME_TOKENS: ThemeToken[] = [
  {
    id: "app-background",
    label: "App background",
    cssVar: "--app-background",
    groupId: "app",
    role: "fill",
    targets: ["app-background"],
    source: surfaceRef("canvas"),
  },
  {
    id: "app-foreground",
    label: "App text",
    cssVar: "--app-foreground",
    groupId: "app",
    role: "foreground",
    targets: ["app-foreground"],
    source: ref("ink"),
  },
  {
    id: "sidebar",
    label: "Sidebar",
    cssVar: "--sidebar",
    groupId: "sidebar",
    role: "fill",
    targets: ["sidebar"],
    source: surfaceRef("raised"),
  },
  {
    id: "sidebar-foreground",
    label: "Sidebar text",
    cssVar: "--sidebar-foreground",
    groupId: "sidebar",
    role: "foreground",
    targets: ["sidebar-foreground"],
    source: ref("ink"),
  },
  {
    id: "sidebar-border",
    label: "Sidebar border",
    cssVar: "--sidebar-border",
    groupId: "sidebar",
    role: "border",
    targets: ["sidebar-border"],
    source: line,
  },
  {
    id: "sidebar-hover",
    label: "Sidebar hover",
    cssVar: "--sidebar-hover",
    groupId: "sidebar",
    role: "hover",
    targets: ["sidebar-hover"],
    source: hover,
  },
  {
    id: "chat",
    label: "Chat canvas",
    cssVar: "--chat-background",
    groupId: "chat",
    role: "fill",
    targets: ["chat"],
    source: surfaceRef("canvas"),
  },
  {
    id: "message-user",
    label: "User message",
    cssVar: "--message-user",
    groupId: "message-user",
    role: "fill",
    targets: ["message-user"],
    source: surfaceRef("emphasis"),
  },
  {
    id: "message-user-foreground",
    label: "User message text",
    cssVar: "--message-user-foreground",
    groupId: "message-user",
    role: "foreground",
    targets: ["message-user-foreground"],
    source: ref("ink"),
  },
  {
    id: "message-user-border",
    label: "User message border",
    cssVar: "--message-user-border",
    groupId: "message-user",
    role: "border",
    targets: ["message-user-border"],
    source: line,
  },
  {
    id: "message-assistant",
    label: "Assistant message",
    cssVar: "--message-assistant",
    groupId: "message-assistant",
    role: "fill",
    targets: ["message-assistant"],
    source: surfaceRef("raised"),
  },
  {
    id: "message-assistant-foreground",
    label: "Assistant message text",
    cssVar: "--message-assistant-foreground",
    groupId: "message-assistant",
    role: "foreground",
    targets: ["message-assistant-foreground"],
    source: ref("ink"),
  },
  {
    id: "message-assistant-border",
    label: "Assistant message border",
    cssVar: "--message-assistant-border",
    groupId: "message-assistant",
    role: "border",
    targets: ["message-assistant-border"],
    source: line,
  },
  {
    id: "composer",
    label: "Composer",
    cssVar: "--composer",
    groupId: "composer",
    role: "fill",
    targets: ["composer"],
    source: surfaceRef("raised"),
  },
  {
    id: "composer-foreground",
    label: "Composer text",
    cssVar: "--composer-foreground",
    groupId: "composer",
    role: "foreground",
    targets: ["composer-foreground"],
    source: ref("ink"),
  },
  {
    id: "composer-border",
    label: "Composer border",
    cssVar: "--composer-border",
    groupId: "composer",
    role: "border",
    targets: ["composer-border"],
    source: line,
  },
  {
    id: "tree-chrome",
    label: "Tree chrome",
    cssVar: "--tree-chrome-background",
    groupId: "tree",
    role: "fill",
    targets: ["tree-chrome"],
    source: { ref: "paper", alpha: 0.9 },
  },
  {
    id: "tree-overlay",
    label: "Tree overlay",
    cssVar: "--tree-overlay-background",
    groupId: "tree",
    role: "other",
    targets: ["tree-overlay"],
    source: { ref: "paper", alpha: 0.45 },
  },
  {
    id: "tree-grid",
    label: "Tree grid",
    cssVar: "--tree-grid-color",
    groupId: "tree",
    role: "other",
    targets: ["tree-grid"],
    source: { ref: "muted", alpha: 0.18 },
  },
  {
    id: "tree-edge",
    label: "Tree edge",
    cssVar: "--tree-edge-color",
    groupId: "tree",
    role: "border",
    targets: ["tree-edge"],
    source: { kind: "derive", as: "line", onto: "canvas" },
  },
  {
    id: "tree-active",
    label: "Tree active",
    cssVar: "--tree-active-color",
    groupId: "tree",
    role: "other",
    targets: ["tree-active"],
    source: { ref: "accent", alpha: 0.7 },
  },
  {
    id: "tree-focus",
    label: "Tree focus",
    cssVar: "--tree-focus-color",
    groupId: "tree",
    role: "other",
    targets: ["tree-focus"],
    source: { ref: "accent", alpha: 0.7 },
  },
  {
    id: "tree-path",
    label: "Tree path",
    cssVar: "--tree-path-color",
    groupId: "tree",
    role: "other",
    targets: ["tree-path"],
    source: { ref: "accent", alpha: 0.35 },
  },
  {
    id: "tree-active-surface",
    label: "Tree active surface",
    cssVar: "--tree-active-surface",
    groupId: "tree",
    role: "other",
    targets: ["tree-active-surface"],
    source: { ref: "accent", alpha: 0.2 },
  },
  {
    id: "tree-minimap-background",
    label: "Minimap background",
    cssVar: "--tree-minimap-background",
    groupId: "tree",
    role: "other",
    targets: ["tree-minimap-background"],
    source: surfaceRef("control"),
  },
  {
    id: "tree-minimap-edge",
    label: "Minimap edge",
    cssVar: "--tree-minimap-edge",
    groupId: "tree",
    role: "other",
    targets: ["tree-minimap-edge"],
    source: mix("muted", surfaceRef("control"), 0.7),
  },
  {
    id: "tree-minimap-node",
    label: "Minimap assistant card",
    cssVar: "--tree-minimap-node",
    groupId: "tree",
    role: "other",
    targets: ["tree-minimap-node"],
    source: surfaceRef("raised"),
  },
  {
    id: "tree-minimap-user",
    label: "Minimap user card",
    cssVar: "--tree-minimap-user",
    groupId: "tree",
    role: "other",
    targets: ["tree-minimap-user"],
    source: surfaceRef("emphasis"),
  },
  {
    id: "tree-minimap-user-rail",
    label: "Minimap user rail",
    cssVar: "--tree-minimap-user-rail",
    groupId: "tree",
    role: "other",
    targets: ["tree-minimap-user-rail"],
    source: { ref: "ink", alpha: 0.42 },
  },
  {
    id: "tree-minimap-glyph",
    label: "Minimap card lines",
    cssVar: "--tree-minimap-glyph",
    groupId: "tree",
    role: "other",
    targets: ["tree-minimap-glyph"],
    source: { ref: "ink", alpha: 0.28 },
  },
  {
    id: "tree-minimap-path",
    label: "Minimap path",
    cssVar: "--tree-minimap-path",
    groupId: "tree",
    role: "other",
    targets: ["tree-minimap-path"],
    source: mix("accent", "muted", 0.82),
  },
  {
    id: "tree-minimap-focus",
    label: "Minimap focus",
    cssVar: "--tree-minimap-focus",
    groupId: "tree",
    role: "other",
    targets: ["tree-minimap-focus"],
    source: ref("accent"),
  },
  {
    id: "tree-viewport",
    label: "Tree viewport",
    cssVar: "--tree-viewport-color",
    groupId: "tree",
    role: "foreground",
    targets: ["tree-viewport"],
    source: ref("ink"),
  },
  {
    id: "settings-card",
    label: "Settings card",
    cssVar: "--settings-card",
    groupId: "settings",
    role: "fill",
    targets: ["settings-card"],
    source: surfaceRef("raised"),
  },
  {
    id: "settings-card-foreground",
    label: "Settings card text",
    cssVar: "--settings-card-foreground",
    groupId: "settings",
    role: "foreground",
    targets: ["settings-card-foreground"],
    source: ref("ink"),
  },
  {
    id: "settings-card-border",
    label: "Settings card border",
    cssVar: "--settings-card-border",
    groupId: "settings",
    role: "border",
    targets: ["settings-card-border"],
    source: line,
  },
  {
    id: "popover",
    label: "Popover",
    cssVar: "--popover",
    groupId: "popover",
    role: "fill",
    targets: ["popover"],
    source: surfaceRef("overlay"),
  },
  {
    id: "popover-foreground",
    label: "Popover text",
    cssVar: "--popover-foreground",
    groupId: "popover",
    role: "foreground",
    targets: ["popover-foreground"],
    source: ref("ink"),
  },
  {
    id: "popover-border",
    label: "Popover border",
    cssVar: "--popover-border",
    groupId: "popover",
    role: "border",
    targets: ["popover-border"],
    source: line,
  },
  {
    id: "input",
    label: "Input",
    cssVar: "--input",
    groupId: "input",
    role: "fill",
    targets: ["input"],
    source: surfaceRef("control"),
  },
  {
    id: "input-border",
    label: "Input border",
    cssVar: "--input-border",
    groupId: "input",
    role: "border",
    targets: ["input-border"],
    source: line,
  },
  {
    id: "ring",
    label: "Focus ring",
    cssVar: "--ring",
    groupId: "input",
    role: "ring",
    targets: ["ring"],
    source: ref("accent"),
  },
  {
    id: "button",
    label: "Button",
    cssVar: "--button",
    groupId: "button",
    role: "fill",
    targets: ["button"],
    source: ref("accent"),
  },
  {
    id: "button-foreground",
    label: "Button text",
    cssVar: "--button-foreground",
    groupId: "button",
    role: "foreground",
    targets: ["button-foreground"],
    source: ref("paper"),
  },
  {
    id: "button-hover",
    label: "Button hover",
    cssVar: "--button-hover",
    groupId: "button",
    role: "hover",
    targets: ["button-hover"],
    source: mix("paper", groupFill("button"), 0.2),
  },
  {
    id: "danger",
    label: "Danger text",
    cssVar: "--danger",
    groupId: "danger",
    role: "foreground",
    targets: ["danger"],
    source: ref("danger"),
  },
  {
    id: "danger-fill",
    label: "Danger fill",
    cssVar: "--danger-fill",
    groupId: "danger",
    role: "fill",
    targets: ["danger-fill"],
    source: { ref: "danger", alpha: 0.12 },
  },
  {
    id: "danger-foreground",
    label: "Danger on fill",
    cssVar: "--danger-foreground",
    groupId: "danger",
    role: "other",
    targets: ["danger-foreground"],
    source: ref("paper"),
  },
]

const tokensById = new Map(THEME_TOKENS.map((token) => [token.id, token]))
const tokensByCssVar = new Map<string, ThemeToken>(
  THEME_TOKENS.map((token) => [token.cssVar, token])
)
const tokensByTarget = new Map<string, ThemeToken>()
for (const token of THEME_TOKENS) {
  for (const target of token.targets) tokensByTarget.set(target, token)
}
const groupsById = new Map(THEME_GROUPS.map((group) => [group.id, group]))

export function tokenById(id: string): ThemeToken | null {
  return tokensById.get(id) ?? null
}

export function tokenByCssVar(cssVar: string): ThemeToken | null {
  return tokensByCssVar.get(cssVar) ?? null
}

export function tokenByTarget(target: string): ThemeToken | null {
  return tokensByTarget.get(target) ?? null
}

export function groupById(id: string): ThemeGroup | null {
  return groupsById.get(id as ThemeGroupId) ?? null
}

export function tokensInGroup(groupId: ThemeGroupId): ThemeToken[] {
  return THEME_TOKENS.filter((token) => token.groupId === groupId)
}

export function groupFillVar(groupId: ThemeGroupId): `--${string}` {
  return `--group-${groupId}-fill`
}

export function extraPaletteVar(id: string): `--${string}` {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "-")
  return `--palette-extra-${safe}`
}

/** Aliases so leftover utilities (bg-background, bg-primary, …) still resolve. */
export const COMPILED_ALIASES: Record<string, string> = {
  "--background": "var(--app-background)",
  "--foreground": "var(--app-foreground)",
  "--card": "var(--settings-card)",
  "--card-foreground": "var(--settings-card-foreground)",
  "--primary": "var(--button)",
  "--primary-foreground": "var(--button-foreground)",
  "--secondary": "var(--sidebar-hover)",
  "--secondary-foreground": "var(--app-foreground)",
  "--muted": "var(--sidebar-hover)",
  "--muted-foreground": "var(--palette-muted)",
  "--accent": "var(--sidebar-hover)",
  "--accent-foreground": "var(--app-foreground)",
  "--border": "var(--composer-border)",
  "--destructive": "var(--danger)",
  "--sidebar-primary": "var(--button)",
  "--sidebar-primary-foreground": "var(--button-foreground)",
  "--sidebar-accent": "var(--sidebar-hover)",
  "--sidebar-accent-foreground": "var(--sidebar-foreground)",
  "--sidebar-ring": "var(--ring)",
}

export function isColorValue(value: unknown): value is ColorValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (typeof record.ref === "string") return true
  if (typeof record.literal === "string") return true
  if (record.mix && typeof record.mix === "object" && record.mix !== null) {
    const mixValue = record.mix as Record<string, unknown>
    return (
      isColorValue(mixValue.from) &&
      isColorValue(mixValue.onto) &&
      typeof mixValue.amount === "number"
    )
  }
  return false
}
