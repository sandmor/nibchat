"use client"

import { useEffect, useRef } from "react"
import type { Appearance, ThemeRecord } from "@/lib/appearance"
import { createAppearanceApplier } from "@/lib/apply-appearance"
import {
  setAppearancePersistenceUser,
  useAppearanceStore,
} from "@/lib/appearance-store"

export function AppearanceRuntime({
  themes,
  activeThemeId,
  fallback,
  userId,
}: {
  themes: ThemeRecord[]
  activeThemeId: string
  fallback: Appearance
  userId: string
}) {
  const hydrateThemeLibrary = useAppearanceStore((s) => s.hydrateThemeLibrary)
  const draft = useAppearanceStore((s) => s.draft)
  const preview = useAppearanceStore((s) => s.preview)
  const applierRef = useRef<ReturnType<typeof createAppearanceApplier> | null>(
    null
  )
  const frameRef = useRef<number | null>(null)
  const document = preview?.document ?? draft ?? fallback

  useEffect(() => {
    applierRef.current = createAppearanceApplier()
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
      applierRef.current?.dispose()
      applierRef.current = null
    }
  }, [])

  useEffect(() => {
    setAppearancePersistenceUser(userId)
  }, [userId])

  useEffect(() => {
    hydrateThemeLibrary(themes, activeThemeId)
  }, [activeThemeId, hydrateThemeLibrary, themes])

  useEffect(() => {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      if (preview?.kind === "variable") {
        applierRef.current?.applyVariable(preview.name, preview.value)
      } else {
        applierRef.current?.apply(document)
      }
    })
  }, [document, preview])

  return null
}
