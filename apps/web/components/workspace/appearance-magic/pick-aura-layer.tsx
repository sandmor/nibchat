"use client"

import { useCallback, useEffect, useId, useState } from "react"
import { createPortal } from "react-dom"
import {
  measureGroupGhosts,
  measurePickGhosts,
  shapesToEvenOddPath,
  type PickGhostShape,
} from "@/lib/appearance-pick-geometry"
import {
  queryGroupHosts,
  querySurfacesByCssVar,
} from "@/lib/appearance-targets"

/** Paint-only fixed aura portals for the currently hovered theme target. */
export function PickAuraLayer({
  cssVar,
  groupId,
}: {
  cssVar: string | null
  groupId?: string | null
}) {
  if (!cssVar && !groupId) return null
  return <ActivePickAura cssVar={cssVar} groupId={groupId ?? null} />
}

function ActivePickAura({
  cssVar,
  groupId,
}: {
  cssVar: string | null
  groupId: string | null
}) {
  const reactId = useId()
  const filterId = `${reactId.replace(/:/g, "")}-ghost-glow`
  const [ghosts, setGhosts] = useState<PickGhostShape[]>([])
  const [viewport, setViewport] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }))

  const remesh = useCallback(() => {
    setViewport({ w: window.innerWidth, h: window.innerHeight })
    setGhosts(cssVar ? measurePickGhosts(cssVar) : measureGroupGhosts(groupId))
  }, [cssVar, groupId])

  useEffect(() => {
    const raf = requestAnimationFrame(remesh)
    const ro = new ResizeObserver(remesh)
    ro.observe(document.documentElement)
    const observed = cssVar
      ? querySurfacesByCssVar(cssVar)
      : queryGroupHosts(groupId ?? "")
    for (const element of observed) ro.observe(element)
    window.addEventListener("scroll", remesh, true)
    window.addEventListener("resize", remesh)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener("scroll", remesh, true)
      window.removeEventListener("resize", remesh)
    }
  }, [cssVar, groupId, remesh])

  if (ghosts.length === 0) return null

  return createPortal(
    <svg
      data-magic-chrome
      data-theme-pick-ghosts
      className="pointer-events-none fixed inset-0 z-[70]"
      width={viewport.w}
      height={viewport.h}
      aria-hidden
    >
      <defs>
        <filter id={filterId} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {ghosts.map((ghost) => (
        <path
          key={ghost.key}
          className="theme-pick-ghost-path"
          d={shapesToEvenOddPath(ghost.outer, ghost.holes)}
          fillRule="evenodd"
          clipRule="evenodd"
          filter={`url(#${filterId})`}
        />
      ))}
    </svg>,
    document.body
  )
}
