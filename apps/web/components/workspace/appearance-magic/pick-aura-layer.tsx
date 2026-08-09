"use client"

import { useCallback, useEffect, useId, useState } from "react"
import { createPortal } from "react-dom"
import {
  measurePickGhosts,
  shapesToEvenOddPath,
  type PickGhostShape,
} from "@/lib/appearance-pick-geometry"
import { querySurfacesByCssVar } from "@/lib/appearance-targets"

/**
 * Paint-only fixed aura portals for the currently hovered css token.
 * Uses evenodd SVG paths so nested themed surfaces carve holes, and respects
 * each surface's border-radius (pills, cards, etc.).
 */
export function PickAuraLayer({ cssVar }: { cssVar: string | null }) {
  const reactId = useId()
  const filterId = `${reactId.replace(/:/g, "")}-ghost-glow`
  const [ghosts, setGhosts] = useState<PickGhostShape[]>([])
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const [mounted, setMounted] = useState(false)

  const remesh = useCallback(() => {
    setViewport({ w: window.innerWidth, h: window.innerHeight })
    setGhosts(measurePickGhosts(cssVar))
  }, [cssVar])

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!cssVar) {
      setGhosts([])
      return
    }

    remesh()
    const raf = requestAnimationFrame(() => remesh())

    function onScrollOrResize() {
      remesh()
    }

    const ro = new ResizeObserver(() => remesh())
    ro.observe(document.documentElement)
    for (const el of querySurfacesByCssVar(cssVar)) {
      ro.observe(el)
    }

    window.addEventListener("scroll", onScrollOrResize, true)
    window.addEventListener("resize", onScrollOrResize)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener("scroll", onScrollOrResize, true)
      window.removeEventListener("resize", onScrollOrResize)
    }
  }, [cssVar, remesh])

  if (!mounted || !cssVar || ghosts.length === 0) return null

  return createPortal(
    <svg
      data-magic-chrome
      data-theme-pick-ghosts
      className="pointer-events-none fixed inset-0 z-[70]"
      width={viewport.w || "100%"}
      height={viewport.h || "100%"}
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
      {ghosts.map((g) => (
        <path
          key={g.key}
          className="theme-pick-ghost-path"
          d={shapesToEvenOddPath(g.outer, g.holes)}
          fillRule="evenodd"
          clipRule="evenodd"
          filter={`url(#${filterId})`}
        />
      ))}
    </svg>,
    document.body
  )
}
