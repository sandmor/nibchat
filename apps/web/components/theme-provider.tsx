"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"
import {
  THEME_SLOT_LS_KEY,
  type ResolvedThemeSlot,
  type ThemeSlotMode,
} from "@/lib/theme-slot"

type ThemeSlotContextValue = {
  mode: ThemeSlotMode
  resolved: ResolvedThemeSlot
  toggle: () => void
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

function ThemeSlotBridge({ children }: { children: React.ReactNode }) {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const mounted = useMounted()
  // The server and hydrating render intentionally use light. next-themes has
  // already painted the correct CSS slot before this becomes interactive.
  const resolved: ResolvedThemeSlot =
    mounted && resolvedTheme === "dark" ? "dark" : "light"
  const mode: ThemeSlotMode =
    mounted && (theme === "light" || theme === "dark" || theme === "system")
      ? theme
      : "system"

  const toggle = React.useCallback(() => {
    setTheme(resolved === "dark" ? "light" : "dark")
  }, [resolved, setTheme])

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
    () => ({ mode, resolved, toggle }),
    [mode, resolved, toggle]
  )

  return (
    <ThemeSlotContext.Provider value={value}>
      {children}
    </ThemeSlotContext.Provider>
  )
}

/** Workspace-only slot provider. Its inline script selects the slot pre-paint. */
function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme-slot"
      storageKey={THEME_SLOT_LS_KEY}
      defaultTheme="system"
      enableSystem
      enableColorScheme={false}
      disableTransitionOnChange
      themes={["light", "dark"]}
    >
      <ThemeSlotBridge>{children}</ThemeSlotBridge>
    </NextThemesProvider>
  )
}

function useThemeSlot() {
  const value = React.useContext(ThemeSlotContext)
  if (!value) throw new Error("useThemeSlot must be used within ThemeProvider")
  return value
}

export { ThemeProvider, useThemeSlot }
