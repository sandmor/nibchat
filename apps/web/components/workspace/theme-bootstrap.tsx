import { compileAppearance, type ThemeRecord } from "@/lib/appearance"
import { usesDarkElevation } from "@/lib/appearance-color"
import {
  THEME_SLOT_LS_KEY,
  type ThemeSlotMode,
  userScopedStorageKey,
} from "@/lib/theme-slot"

type SlotTheme = {
  id: string
  vars: Record<string, string>
  scheme: "light" | "dark"
  density: "comfortable" | "compact"
  motionEnabled: boolean
  motionReduced: string
  elevation: "light" | "dark"
}

function slotTheme(theme: ThemeRecord | undefined): SlotTheme | null {
  if (!theme) return null
  const document = theme.document
  return {
    id: theme.id,
    vars: compileAppearance(document),
    scheme: document.scheme,
    density: document.density,
    motionEnabled: document.motion.enabled,
    motionReduced: document.motion.reducedMotion,
    elevation: usesDarkElevation(document) ? "dark" : "light",
  }
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}

/**
 * Server-rendered blocking script: choose the color slot, then apply the
 * assigned theme before the workspace shell paints.
 */
export function ThemeBootstrap({
  themes,
  lightThemeId,
  darkThemeId,
  userId,
  initialMode = "system",
}: {
  themes: ThemeRecord[]
  lightThemeId: string
  darkThemeId: string
  userId?: string
  initialMode?: ThemeSlotMode
}) {
  const payload = {
    light: slotTheme(themes.find((theme) => theme.id === lightThemeId)),
    dark: slotTheme(themes.find((theme) => theme.id === darkThemeId)),
  }
  const storageKey = userScopedStorageKey(THEME_SLOT_LS_KEY, userId)
  const script = `(function(data,key,fallback){try{var root=document.documentElement;var mode;try{mode=localStorage.getItem(key)||fallback}catch(_){mode=fallback}var slot=mode==="dark"||mode==="light"?mode:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");root.setAttribute("data-theme-slot",slot);var theme=data[slot]||data.light||data.dark;if(!theme)return;Object.keys(theme.vars).forEach(function(name){if(name.slice(0,2)==="--")root.style.setProperty(name,theme.vars[name])});root.dataset.density=theme.density;root.dataset.motionEnabled=String(theme.motionEnabled);root.dataset.motionReduced=theme.motionReduced;root.dataset.elevation=theme.elevation;root.classList.toggle("dark",theme.scheme==="dark");root.style.colorScheme=theme.scheme;root.dataset.nibchatThemeId=theme.id}catch(_){}})(${safeJson(payload)},${safeJson(storageKey)},${safeJson(initialMode)})`

  return (
    <script
      id="nibchat-theme-bootstrap"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: script }}
    />
  )
}
