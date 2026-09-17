"use client"

import { useEffect, useState, useSyncExternalStore } from "react"

const subscribeBrowserValue = () => () => {}
const readBrowserTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
const readServerTimeZone = () => null

/** Returns null for the server and hydrating renders, then the browser zone. */
export function useBrowserTimeZone(): string | null {
  return useSyncExternalStore(
    subscribeBrowserValue,
    readBrowserTimeZone,
    readServerTimeZone
  )
}

export function usePrefersReducedMotion() {
  const [prefers, setPrefers] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const apply = () => setPrefers(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])
  return prefers
}

export function useMediaMdUp() {
  const [mdUp, setMdUp] = useState(true)
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)")
    const apply = () => setMdUp(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])
  return mdUp
}

function subscribeStorageKey(key: string) {
  return (onChange: () => void) => {
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
  }
}

/** Same value on the server and during hydration; browser storage applies after. */
export function useUserStorageValue(
  userId: string,
  baseKey: string,
  serverValue: string
) {
  const key = `${baseKey}.${userId}`
  const value = useSyncExternalStore(
    subscribeStorageKey(key),
    () => {
      try {
        return localStorage.getItem(key) ?? serverValue
      } catch {
        return serverValue
      }
    },
    () => serverValue
  )
  function setValue(next: string) {
    try {
      localStorage.setItem(key, next)
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(`nibchat:${key}`))
  }
  return [value, setValue] as const
}
