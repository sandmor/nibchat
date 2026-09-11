"use client"

import * as React from "react"
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
  /** False until the browser slot is known (not the SSR placeholder). */
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

function isThemeMode(value: string | null): value is ThemeSlotMode {
  return value === "light" || value === "dark" || value === "system"
}

function systemSlot(): ResolvedThemeSlot {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

function applySlot(slot: ResolvedThemeSlot) {
  document.documentElement.setAttribute("data-theme-slot", slot)
}

function readStoredMode(key: string, fallback: ThemeSlotMode): ThemeSlotMode {
  try {
    const stored = localStorage.getItem(key)
    if (isThemeMode(stored)) return stored
  } catch {
    /* ignore */
  }
  return fallback
}

function useStoredThemeMode(key: string, fallback: ThemeSlotMode) {
  return React.useSyncExternalStore(
    (onChange) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) onChange()
      }
      const onLocal = () => onChange()
      window.addEventListener("storage", onStorage)
      window.addEventListener(`nibchat:${key}`, onLocal)
      return () => {
        window.removeEventListener("storage", onStorage)
        window.removeEventListener(`nibchat:${key}`, onLocal)
      }
    },
    () => readStoredMode(key, fallback),
    () => fallback
  )
}

function useSystemPrefersDark() {
  return React.useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia("(prefers-color-scheme: dark)")
      media.addEventListener("change", onChange)
      return () => media.removeEventListener("change", onChange)
    },
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false
  )
}

function useMounted() {
  return React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
}

/** Workspace-only slot provider. The blocking bootstrap script selects the slot pre-paint. */
function ThemeProvider({
  children,
  userId,
  initialMode = "system",
}: {
  children: React.ReactNode
  userId?: string
  initialMode?: ThemeSlotMode
}) {
  const storageKey = userScopedStorageKey(THEME_SLOT_LS_KEY, userId)
  const mounted = useMounted()
  const storedMode = useStoredThemeMode(storageKey, initialMode)
  const prefersDark = useSystemPrefersDark()
  const mode: ThemeSlotMode = storedMode
  const resolved: ResolvedThemeSlot =
    mode === "system" ? (prefersDark ? "dark" : "light") : mode
  const ready = mounted

  const setMode = React.useCallback(
    (next: ThemeSlotMode) => {
      try {
        localStorage.setItem(storageKey, next)
      } catch {
        /* ignore */
      }
      applySlot(next === "system" ? systemSlot() : next)
      window.dispatchEvent(new Event(`nibchat:${storageKey}`))
    },
    [storageKey]
  )

  const toggle = React.useCallback(() => {
    setMode(resolved === "dark" ? "light" : "dark")
  }, [resolved, setMode])

  React.useEffect(() => {
    if (!mounted) return
    applySlot(resolved)
  }, [mounted, resolved])

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

function useThemeSlot() {
  const value = React.useContext(ThemeSlotContext)
  if (!value) throw new Error("useThemeSlot must be used within ThemeProvider")
  return value
}

export { ThemeProvider, useThemeSlot }
