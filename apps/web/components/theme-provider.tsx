"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"
import {
  THEME_SLOT_LS_KEY,
  type ResolvedThemeSlot,
  type ThemeSlotMode,
  userScopedStorageKey,
} from "@/lib/theme-slot"

type ThemeSlotContextValue = {
  mode: ThemeSlotMode
  resolved: ResolvedThemeSlot
  toggle: () => void
  /** False until next-themes has a real selected mode (not the SSR placeholder). */
  ready: boolean
}

const ThemeSlotContext = React.createContext<ThemeSlotContextValue | null>(null)

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

function useMounted() {
  return React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
}

function ThemeSlotBridge({
  children,
  userId,
}: {
  children: React.ReactNode
  userId?: string
}) {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const mounted = useMounted()
  // The server and hydrating render intentionally use light. next-themes has
  // already painted the correct CSS slot before this becomes interactive.
  const selectedMode: ThemeSlotMode | null =
    theme === "light" || theme === "dark" || theme === "system" ? theme : null
  const ready = mounted && selectedMode != null
  const resolved: ResolvedThemeSlot =
    mounted && resolvedTheme === "dark" ? "dark" : "light"
  const mode: ThemeSlotMode = selectedMode ?? "system"

  const toggle = React.useCallback(() => {
    setTheme(resolved === "dark" ? "light" : "dark")
  }, [resolved, setTheme])

  React.useEffect(() => {
    document.documentElement.dataset.nibchatUserId = userId ?? ""
    return () => {
      delete document.documentElement.dataset.nibchatUserId
    }
  }, [userId])

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if ((event.key ?? "").toLowerCase() !== "d") return
      if (isTypingTarget(event.target)) return
      toggle()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [toggle])

  const value = React.useMemo(
    () => ({ mode, resolved, toggle, ready }),
    [mode, ready, resolved, toggle]
  )

  return (
    <ThemeSlotContext.Provider value={value}>
      {children}
    </ThemeSlotContext.Provider>
  )
}

/** Workspace-only slot provider. Its inline script selects the slot pre-paint. */
function ThemeProvider({
  children,
  userId,
  initialMode = "system",
}: {
  children: React.ReactNode
  userId?: string
  initialMode?: ThemeSlotMode
}) {
  return (
    <NextThemesProvider
      attribute="data-theme-slot"
      storageKey={userScopedStorageKey(THEME_SLOT_LS_KEY, userId)}
      defaultTheme={initialMode}
      enableSystem
      enableColorScheme={false}
      disableTransitionOnChange
      themes={["light", "dark"]}
    >
      <ThemeSlotBridge userId={userId}>{children}</ThemeSlotBridge>
    </NextThemesProvider>
  )
}

function useThemeSlot() {
  const value = React.useContext(ThemeSlotContext)
  if (!value) throw new Error("useThemeSlot must be used within ThemeProvider")
  return value
}

export { ThemeProvider, useThemeSlot }
