/**
 * Theme token registry: groups, pickable surfaces, and default recipes.
 * Recipes bind only to palette roles (and group fills). Stored documents
 * overlay group paints and individual token overrides on top of this.
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

export type ThemeToken = {
  id: string
  label: string
  cssVar: `--${string}`
  groupId: ThemeGroupId
  role: TokenRole
  targets: string[]
  recipe: ColorValue
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

function groupFill(groupId: ThemeGroupId): ColorValue {
  return { ref: `group:${groupId}` }
}

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
    recipe: ref("paper"),
  },
  {
    id: "app-foreground",
    label: "App text",
    cssVar: "--app-foreground",
    groupId: "app",
    role: "foreground",
    targets: ["app-foreground"],
    recipe: ref("ink"),
  },
  {
    id: "sidebar",
    label: "Sidebar",
    cssVar: "--sidebar",
    groupId: "sidebar",
    role: "fill",
    targets: ["sidebar"],
    recipe: mix("ink", "paper", 0.015),
  },
  {
    id: "sidebar-foreground",
    label: "Sidebar text",
    cssVar: "--sidebar-foreground",
    groupId: "sidebar",
    role: "foreground",
    targets: ["sidebar-foreground"],
    recipe: ref("ink"),
  },
  {
    id: "sidebar-border",
    label: "Sidebar border",
    cssVar: "--sidebar-border",
    groupId: "sidebar",
    role: "border",
    targets: ["sidebar-border"],
    recipe: mix("ink", groupFill("sidebar"), 0.08),
  },
  {
    id: "sidebar-hover",
    label: "Sidebar hover",
    cssVar: "--sidebar-hover",
    groupId: "sidebar",
    role: "hover",
    targets: ["sidebar-hover"],
    recipe: mix("ink", groupFill("sidebar"), 0.06),
  },
  {
    id: "chat",
    label: "Chat canvas",
    cssVar: "--chat-background",
    groupId: "chat",
    role: "fill",
    targets: ["chat"],
    recipe: ref("paper"),
  },
  {
    id: "message-user",
    label: "User message",
    cssVar: "--message-user",
    groupId: "message-user",
    role: "fill",
    targets: ["message-user"],
    recipe: mix("ink", "paper", 0.04),
  },
  {
    id: "message-user-foreground",
    label: "User message text",
    cssVar: "--message-user-foreground",
    groupId: "message-user",
    role: "foreground",
    targets: ["message-user-foreground"],
    recipe: ref("ink"),
  },
  {
    id: "message-user-border",
    label: "User message border",
    cssVar: "--message-user-border",
    groupId: "message-user",
    role: "border",
    targets: ["message-user-border"],
    recipe: mix("ink", groupFill("message-user"), 0.08),
  },
  {
    id: "message-assistant",
    label: "Assistant message",
    cssVar: "--message-assistant",
    groupId: "message-assistant",
    role: "fill",
    targets: ["message-assistant"],
    recipe: ref("paper"),
  },
  {
    id: "message-assistant-foreground",
    label: "Assistant message text",
    cssVar: "--message-assistant-foreground",
    groupId: "message-assistant",
    role: "foreground",
    targets: ["message-assistant-foreground"],
    recipe: ref("ink"),
  },
  {
    id: "message-assistant-border",
    label: "Assistant message border",
    cssVar: "--message-assistant-border",
    groupId: "message-assistant",
    role: "border",
    targets: ["message-assistant-border"],
    recipe: mix("ink", groupFill("message-assistant"), 0.08),
  },
  {
    id: "composer",
    label: "Composer",
    cssVar: "--composer",
    groupId: "composer",
    role: "fill",
    targets: ["composer"],
    recipe: ref("paper"),
  },
  {
    id: "composer-foreground",
    label: "Composer text",
    cssVar: "--composer-foreground",
    groupId: "composer",
    role: "foreground",
    targets: ["composer-foreground"],
    recipe: ref("ink"),
  },
  {
    id: "composer-border",
    label: "Composer border",
    cssVar: "--composer-border",
    groupId: "composer",
    role: "border",
    targets: ["composer-border"],
    recipe: mix("ink", groupFill("composer"), 0.08),
  },
  {
    id: "tree-chrome",
    label: "Tree chrome",
    cssVar: "--tree-chrome-background",
    groupId: "tree",
    role: "fill",
    targets: ["tree-chrome"],
    recipe: { ref: "paper", alpha: 0.9 },
  },
  {
    id: "tree-overlay",
    label: "Tree overlay",
    cssVar: "--tree-overlay-background",
    groupId: "tree",
    role: "other",
    targets: ["tree-overlay"],
    recipe: { ref: "paper", alpha: 0.45 },
  },
  {
    id: "tree-grid",
    label: "Tree grid",
    cssVar: "--tree-grid-color",
    groupId: "tree",
    role: "other",
    targets: ["tree-grid"],
    recipe: { ref: "muted", alpha: 0.18 },
  },
  {
    id: "tree-edge",
    label: "Tree edge",
    cssVar: "--tree-edge-color",
    groupId: "tree",
    role: "border",
    targets: ["tree-edge"],
    recipe: mix("ink", "paper", 0.08),
  },
  {
    id: "tree-active",
    label: "Tree active",
    cssVar: "--tree-active-color",
    groupId: "tree",
    role: "other",
    targets: ["tree-active"],
    recipe: { ref: "accent", alpha: 0.7 },
  },
  {
    id: "tree-focus",
    label: "Tree focus",
    cssVar: "--tree-focus-color",
    groupId: "tree",
    role: "other",
    targets: ["tree-focus"],
    recipe: { ref: "accent", alpha: 0.7 },
  },
  {
    id: "tree-path",
    label: "Tree path",
    cssVar: "--tree-path-color",
    groupId: "tree",
    role: "other",
    targets: ["tree-path"],
    recipe: { ref: "accent", alpha: 0.35 },
  },
  {
    id: "tree-active-surface",
    label: "Tree active surface",
    cssVar: "--tree-active-surface",
    groupId: "tree",
    role: "other",
    targets: ["tree-active-surface"],
    recipe: { ref: "accent", alpha: 0.2 },
  },
  {
    id: "tree-minimap-background",
    label: "Minimap background",
    cssVar: "--tree-minimap-background",
    groupId: "tree",
    role: "other",
    targets: ["tree-minimap-background"],
    recipe: mix("ink", "paper", 0.08),
  },
  {
    id: "tree-minimap-edge",
    label: "Minimap edge",
    cssVar: "--tree-minimap-edge",
    groupId: "tree",
    role: "other",
    targets: ["tree-minimap-edge"],
    recipe: mix("muted", mix("ink", "paper", 0.08), 0.7),
  },
  {
    id: "tree-minimap-node",
    label: "Minimap assistant card",
    cssVar: "--tree-minimap-node",
    groupId: "tree",
    role: "other",
    targets: ["tree-minimap-node"],
    recipe: ref("paper"),
  },
  {
    id: "tree-minimap-user",
    label: "Minimap user card",
    cssVar: "--tree-minimap-user",
    groupId: "tree",
    role: "other",
    targets: ["tree-minimap-user"],
    recipe: mix("ink", "paper", 0.12),
  },
  {
    id: "tree-minimap-user-rail",
    label: "Minimap user rail",
    cssVar: "--tree-minimap-user-rail",
    groupId: "tree",
    role: "other",
    targets: ["tree-minimap-user-rail"],
    recipe: { ref: "ink", alpha: 0.42 },
  },
  {
    id: "tree-minimap-glyph",
    label: "Minimap card lines",
    cssVar: "--tree-minimap-glyph",
    groupId: "tree",
    role: "other",
    targets: ["tree-minimap-glyph"],
    recipe: { ref: "ink", alpha: 0.28 },
  },
  {
    id: "tree-minimap-path",
    label: "Minimap path",
    cssVar: "--tree-minimap-path",
    groupId: "tree",
    role: "other",
    targets: ["tree-minimap-path"],
    recipe: mix("accent", "muted", 0.82),
  },
  {
    id: "tree-minimap-focus",
    label: "Minimap focus",
    cssVar: "--tree-minimap-focus",
    groupId: "tree",
    role: "other",
    targets: ["tree-minimap-focus"],
    recipe: ref("accent"),
  },
  {
    id: "tree-viewport",
    label: "Tree viewport",
    cssVar: "--tree-viewport-color",
    groupId: "tree",
    role: "foreground",
    targets: ["tree-viewport"],
    recipe: ref("ink"),
  },
  {
    id: "settings-card",
    label: "Settings card",
    cssVar: "--settings-card",
    groupId: "settings",
    role: "fill",
    targets: ["settings-card"],
    recipe: ref("paper"),
  },
  {
    id: "settings-card-foreground",
    label: "Settings card text",
    cssVar: "--settings-card-foreground",
    groupId: "settings",
    role: "foreground",
    targets: ["settings-card-foreground"],
    recipe: ref("ink"),
  },
  {
    id: "settings-card-border",
    label: "Settings card border",
    cssVar: "--settings-card-border",
    groupId: "settings",
    role: "border",
    targets: ["settings-card-border"],
    recipe: mix("ink", groupFill("settings"), 0.08),
  },
  {
    id: "popover",
    label: "Popover",
    cssVar: "--popover",
    groupId: "popover",
    role: "fill",
    targets: ["popover"],
    recipe: ref("paper"),
  },
  {
    id: "popover-foreground",
    label: "Popover text",
    cssVar: "--popover-foreground",
    groupId: "popover",
    role: "foreground",
    targets: ["popover-foreground"],
    recipe: ref("ink"),
  },
  {
    id: "popover-border",
    label: "Popover border",
    cssVar: "--popover-border",
    groupId: "popover",
    role: "border",
    targets: ["popover-border"],
    recipe: mix("ink", groupFill("popover"), 0.08),
  },
  {
    id: "input",
    label: "Input",
    cssVar: "--input",
    groupId: "input",
    role: "fill",
    targets: ["input"],
    recipe: mix("ink", "paper", 0.08),
  },
  {
    id: "input-border",
    label: "Input border",
    cssVar: "--input-border",
    groupId: "input",
    role: "border",
    targets: ["input-border"],
    recipe: mix("ink", "paper", 0.08),
  },
  {
    id: "ring",
    label: "Focus ring",
    cssVar: "--ring",
    groupId: "input",
    role: "ring",
    targets: ["ring"],
    recipe: ref("accent"),
  },
  {
    id: "button",
    label: "Button",
    cssVar: "--button",
    groupId: "button",
    role: "fill",
    targets: ["button"],
    recipe: ref("accent"),
  },
  {
    id: "button-foreground",
    label: "Button text",
    cssVar: "--button-foreground",
    groupId: "button",
    role: "foreground",
    targets: ["button-foreground"],
    recipe: ref("paper"),
  },
  {
    id: "button-hover",
    label: "Button hover",
    cssVar: "--button-hover",
    groupId: "button",
    role: "hover",
    targets: ["button-hover"],
    recipe: mix("paper", groupFill("button"), 0.2),
  },
  {
    id: "danger",
    label: "Danger text",
    cssVar: "--danger",
    groupId: "danger",
    role: "foreground",
    targets: ["danger"],
    recipe: ref("danger"),
  },
  {
    id: "danger-fill",
    label: "Danger fill",
    cssVar: "--danger-fill",
    groupId: "danger",
    role: "fill",
    targets: ["danger-fill"],
    recipe: { ref: "danger", alpha: 0.12 },
  },
  {
    id: "danger-foreground",
    label: "Danger on fill",
    cssVar: "--danger-foreground",
    groupId: "danger",
    role: "other",
    targets: ["danger-foreground"],
    recipe: ref("paper"),
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
