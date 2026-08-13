"use client"

import { useEffect, useState } from "react"
import type { ChatRow } from "@/lib/types"
import { parseJson } from "@/lib/domain"
import {
  firstEnabledModelId,
  parseProviderModelsJson,
} from "@/lib/provider-models"
import type { ModelConfigLocal, ProviderSummary } from "./types"

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
