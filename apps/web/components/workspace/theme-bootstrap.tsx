import { compileAppearance, type ThemeRecord } from "@/lib/appearance"
import { usesDarkElevation } from "@/lib/appearance-color"
import { resolveSpaceAppearance } from "@/lib/spaces/appearance"
import type { SpaceRecord } from "@/lib/spaces/tree"
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

function slotTheme(
  theme: Pick<ThemeRecord, "id" | "document"> | undefined
): SlotTheme | null {
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
  spaces = [],
  chats = [],
}: {
  themes: ThemeRecord[]
  lightThemeId: string
  darkThemeId: string
  userId?: string
  initialMode?: ThemeSlotMode
  spaces?: SpaceRecord[]
  chats?: Array<{ id: string; space_id: string | null }>
}) {
  const user = {
    light: slotTheme(themes.find((theme) => theme.id === lightThemeId)),
    dark: slotTheme(themes.find((theme) => theme.id === darkThemeId)),
  }
  const customizedSpaces: Record<
    string,
    { light: SlotTheme | null; dark: SlotTheme | null }
  > = {}
  for (const space of spaces) {
    const appearanceFor = (slot: "light" | "dark") => {
      const resolved = resolveSpaceAppearance({
        spaceId: space.id,
        spaces,
        slot,
        userThemeId: slot === "light" ? lightThemeId : darkThemeId,
        themes,
      })
      return slotTheme({ id: resolved.themeId, document: resolved.document })
    }
    const pair = { light: appearanceFor("light"), dark: appearanceFor("dark") }
    if (JSON.stringify(pair) !== JSON.stringify(user)) {
      customizedSpaces[space.id] = pair
    }
  }
  const payload = {
    user,
    spaces: customizedSpaces,
    chatSpaces: Object.fromEntries(
      chats.flatMap((chat) =>
        chat.space_id && customizedSpaces[chat.space_id]
          ? [[chat.id, chat.space_id]]
          : []
      )
    ),
  }
  const storageKey = userScopedStorageKey(THEME_SLOT_LS_KEY, userId)
  const script = `(function(data,key,fallback){try{var root=document.documentElement;var mode;try{mode=localStorage.getItem(key)||fallback}catch(_){mode=fallback}var slot=mode==="dark"||mode==="light"?mode:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");root.setAttribute("data-theme-slot",slot);var path=window.location.pathname;var spaceId=null;if(path.indexOf("/space/")===0)spaceId=path.split("/")[2];else if(path.indexOf("/chat/")===0){var chatId=path.split("/")[2];spaceId=chatId==="new"?new URLSearchParams(window.location.search).get("space"):data.chatSpaces[chatId]}var pair=data.spaces[spaceId]||data.user;var theme=pair[slot]||data.user[slot]||data.user.light||data.user.dark;if(!theme)return;Object.keys(theme.vars).forEach(function(name){if(name.slice(0,2)==="--")root.style.setProperty(name,theme.vars[name])});root.dataset.density=theme.density;root.dataset.motionEnabled=String(theme.motionEnabled);root.dataset.motionReduced=theme.motionReduced;root.dataset.elevation=theme.elevation;root.classList.toggle("dark",theme.scheme==="dark");root.style.colorScheme=theme.scheme;root.dataset.nibchatThemeId=theme.id}catch(_){}})(${safeJson(payload)},${safeJson(storageKey)},${safeJson(initialMode)})`

  return (
    <script
      id="nibchat-theme-bootstrap"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: script }}
    />
  )
}
