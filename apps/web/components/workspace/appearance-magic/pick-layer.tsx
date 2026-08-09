"use client"

import { useEffect, useState } from "react"
import {
  resolveThemeTargetAtPoint,
  surfaceById,
} from "@/lib/appearance-targets"
import { useAppearanceStore } from "@/lib/appearance-store"
import { PickAuraLayer } from "./pick-aura-layer"

/** Pencil cursor for fine pointers while pick is armed. */
const PENCIL_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23111' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 20h9'/%3E%3Cpath d='M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'/%3E%3C/svg%3E") 2 22, pointer`

/**
 * Armed pick controller: portal hover ghosts + click-capture freeze + under-cursor select.
 * Ghosts never own hits (paint only). Selection is always resolveThemeTargetAtPoint.
 * While a surface is open in the color picker, its css token is not ghosted so live
 * color feedback stays readable under the pointer.
 */
export function AppearancePickLayer() {
  const open = useAppearanceStore((s) => s.open)
  const pickArmed = useAppearanceStore((s) => s.pickArmed)
  const selectedSurfaceId = useAppearanceStore((s) => s.selectedSurfaceId)
  const selectSurface = useAppearanceStore((s) => s.selectSurface)
  const [hoverCssVar, setHoverCssVar] = useState<string | null>(null)

  const active = open && pickArmed
  const editingCssVar = selectedSurfaceId
    ? (surfaceById(selectedSurfaceId)?.cssVar ?? null)
    : null
  // Suppress ghost for the token currently being edited (even when still hovered).
  const auraCssVar =
    hoverCssVar && hoverCssVar !== editingCssVar ? hoverCssVar : null

  useEffect(() => {
    if (!active) {
      setHoverCssVar(null)
      return
    }

    const fine = window.matchMedia("(pointer: fine)").matches
    const prevCursor = document.documentElement.style.cursor
    if (fine) {
      document.documentElement.style.cursor = PENCIL_CURSOR
    }

    function onPointerMove(event: PointerEvent) {
      if (event.pointerType === "touch") return
      const surface = resolveThemeTargetAtPoint(event.clientX, event.clientY)
      setHoverCssVar(surface?.cssVar ?? null)
    }

    function onPointerLeaveDocument() {
      setHoverCssVar(null)
    }

    /**
     * Freeze interactive activation while armed; select via real DOM under point.
     * Magic chrome (orbs/picker) is never intercepted.
     */
    function onClickCapture(event: MouseEvent) {
      const target = event.target
      if (target instanceof Element && target.closest("[data-magic-chrome]")) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const surface = resolveThemeTargetAtPoint(event.clientX, event.clientY)
      if (surface) {
        selectSurface(surface.id, { x: event.clientX, y: event.clientY })
      }
    }

    document.addEventListener("pointermove", onPointerMove, true)
    document.addEventListener("click", onClickCapture, true)
    document.documentElement.addEventListener(
      "pointerleave",
      onPointerLeaveDocument
    )
    return () => {
      document.removeEventListener("pointermove", onPointerMove, true)
      document.removeEventListener("click", onClickCapture, true)
      document.documentElement.removeEventListener(
        "pointerleave",
        onPointerLeaveDocument
      )
      document.documentElement.style.cursor = prevCursor
      setHoverCssVar(null)
    }
  }, [active, selectSurface])

  if (!active) return null

  return <PickAuraLayer cssVar={auraCssVar} />
}
