"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import type { ChatRow } from "@/lib/types"
import { parseJson } from "@/lib/domain"
import {
  firstEnabledModelId,
  parseProviderModelsJson,
} from "@/lib/provider-models"
import type { ModelConfigLocal, ProviderSummary } from "./types"

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

export function seedDraftModelConfig(
  chats: ChatRow[],
  providers: ProviderSummary[]
): ModelConfigLocal {
  if (chats[0])
    return parseJson<ModelConfigLocal>(chats[0].model_config_json, {})
  const provider = providers[0]
  if (!provider) return {}
  const model = firstEnabledModelId(
    parseProviderModelsJson(provider.models_json)
  )
  return {
    providerId: provider.id,
    ...(model ? { model } : {}),
  }
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
