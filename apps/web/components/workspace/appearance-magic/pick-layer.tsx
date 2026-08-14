"use client"

import { useEffect, useState } from "react"
import { tokenById } from "@/lib/appearance-registry"
import { resolveThemeHitAtPoint } from "@/lib/appearance-targets"
import { useAppearanceStore } from "@/lib/appearance-store"
import { PickAuraLayer } from "./pick-aura-layer"

const PENCIL_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23111' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 20h9'/%3E%3Cpath d='M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'/%3E%3C/svg%3E") 2 22, pointer`

export function AppearancePickLayer() {
  const open = useAppearanceStore((s) => s.open)
  const pickArmed = useAppearanceStore((s) => s.pickArmed)
  return open && pickArmed ? <ActivePickLayer /> : null
}

function ActivePickLayer() {
  const selected = useAppearanceStore((s) => s.selected)
  const selectHit = useAppearanceStore((s) => s.selectHit)
  const [hover, setHover] = useState<{
    cssVar: string | null
    groupId: string | null
  }>({ cssVar: null, groupId: null })
  const editingCssVar =
    selected?.kind === "surface"
      ? (tokenById(selected.surfaceId)?.cssVar ?? null)
      : null
  const editingGroupId = selected?.kind === "group" ? selected.groupId : null
  const auraCssVar =
    hover.cssVar && hover.cssVar !== editingCssVar ? hover.cssVar : null
  const auraGroupId =
    !auraCssVar && hover.groupId && hover.groupId !== editingGroupId
      ? hover.groupId
      : null

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches
    const previousCursor = document.documentElement.style.cursor
    if (fine) document.documentElement.style.cursor = PENCIL_CURSOR

    function clearHover() {
      setHover({ cssVar: null, groupId: null })
    }
    function onPointerMove(event: PointerEvent) {
      if (event.pointerType === "touch") return
      const hit = resolveThemeHitAtPoint(event.clientX, event.clientY)
      if (!hit) return clearHover()
      setHover(
        hit.surface
          ? { cssVar: hit.surface.cssVar, groupId: null }
          : { cssVar: null, groupId: hit.group.id }
      )
    }
    function onClickCapture(event: MouseEvent) {
      const target = event.target
      if (target instanceof Element && target.closest("[data-magic-chrome]"))
        return
      event.preventDefault()
      event.stopPropagation()
      const hit = resolveThemeHitAtPoint(event.clientX, event.clientY)
      if (hit) selectHit(hit, { x: event.clientX, y: event.clientY })
    }

    document.addEventListener("pointermove", onPointerMove, true)
    document.addEventListener("click", onClickCapture, true)
    document.documentElement.addEventListener("pointerleave", clearHover)
    return () => {
      document.removeEventListener("pointermove", onPointerMove, true)
      document.removeEventListener("click", onClickCapture, true)
      document.documentElement.removeEventListener("pointerleave", clearHover)
      document.documentElement.style.cursor = previousCursor
    }
  }, [selectHit])

  return <PickAuraLayer cssVar={auraCssVar} groupId={auraGroupId} />
}
