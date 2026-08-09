"use client"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react"
import { HexColorPicker } from "react-colorful"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { cssColorToHex, hexToOklchCss } from "@/lib/appearance-color"
import { surfaceById } from "@/lib/appearance-targets"
import { useAppearanceStore } from "@/lib/appearance-store"

function useCompactPickerLayout() {
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    function update() {
      setCompact(
        window.innerWidth < 640 ||
          window.matchMedia("(pointer: coarse)").matches
      )
    }
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])
  return compact
}

function useViewportMetrics() {
  const [metrics, setMetrics] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 400,
    h: typeof window !== "undefined" ? window.innerHeight : 600,
    scrollbar: 0,
  }))

  useEffect(() => {
    function measure() {
      setMetrics({
        w: window.innerWidth,
        h: window.innerHeight,
        scrollbar: Math.max(
          0,
          window.innerWidth - document.documentElement.clientWidth
        ),
      })
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [])

  return metrics
}

export function SurfaceColorPicker() {
  const selectedSurfaceId = useAppearanceStore((s) => s.selectedSurfaceId)
  const pickPoint = useAppearanceStore((s) => s.pickPoint)
  const draft = useAppearanceStore((s) => s.draft)
  const setVar = useAppearanceStore((s) => s.setVar)
  const selectSurface = useAppearanceStore((s) => s.selectSurface)
  const isNarrow = useCompactPickerLayout()
  const viewport = useViewportMetrics()

  const surface = selectedSurfaceId ? surfaceById(selectedSurfaceId) : null
  const stored = surface && draft ? draft.vars[surface.cssVar] : undefined
  const initialHex = useMemo(
    () => cssColorToHex(stored, "#888888"),
    [selectedSurfaceId, stored]
  )
  const [hex, setHex] = useState(initialHex)

  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    setHex(initialHex)
  }, [initialHex])

  // Focus open + restore on close; Escape dismisses.
  useEffect(() => {
    const open = Boolean(surface && draft)
    if (open && !wasOpenRef.current) {
      const active = document.activeElement
      restoreFocusRef.current =
        active instanceof HTMLElement ? active : null
      requestAnimationFrame(() => {
        dialogRef.current?.focus()
      })
    }
    if (!open && wasOpenRef.current) {
      const restore = restoreFocusRef.current
      restoreFocusRef.current = null
      if (restore?.isConnected) restore.focus()
    }
    wasOpenRef.current = open
  }, [surface, draft])

  useEffect(() => {
    if (!surface || !draft) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        selectSurface(null)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [surface, draft, selectSurface])

  if (!surface || !draft) return null

  function onHexChange(next: string) {
    setHex(next)
    setVar(surface!.cssVar, hexToOklchCss(next))
  }

  const EDGE = 20
  const PANEL_W = 264 // 16.5rem
  const PANEL_H = 320
  const { w: viewW, h: viewH, scrollbar } = viewport

  const panelStyle: CSSProperties | undefined = isNarrow
    ? {
        bottom: `max(${EDGE}px, calc(env(safe-area-inset-bottom, 0px) + ${EDGE}px))`,
        left: EDGE,
        right: EDGE + scrollbar,
      }
    : {
        position: "fixed",
        left: Math.min(
          Math.max(EDGE, (pickPoint?.x ?? 24) + 12),
          Math.max(EDGE, viewW - PANEL_W - EDGE - scrollbar)
        ),
        top: Math.min(
          Math.max(EDGE, (pickPoint?.y ?? 24) + 12),
          Math.max(EDGE, viewH - PANEL_H - EDGE)
        ),
        zIndex: 80,
      }

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      data-magic-chrome
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${surface.label} color`}
      className={cn(
        "z-[80] flex flex-col gap-3 border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none",
        isNarrow
          ? "fixed rounded-2xl pb-4"
          : "fixed w-[16.5rem] rounded-2xl"
      )}
      style={panelStyle}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label className="text-sm font-medium">{surface.label}</Label>
          <p className="text-[11px] text-muted-foreground">{surface.cssVar}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => selectSurface(null)}
        >
          Done
        </Button>
      </div>
      <HexColorPicker
        color={hex}
        onChange={onHexChange}
        style={{ width: "100%", height: isNarrow ? 180 : 140 }}
      />
      <div className="flex items-center gap-2">
        <span
          className="size-8 shrink-0 rounded-md border border-border"
          style={{ background: hex }}
          aria-hidden
        />
        <input
          value={hex}
          onChange={(e) => {
            const v = e.target.value
            setHex(v)
            if (/^#[0-9a-fA-F]{6}$/.test(v)) {
              setVar(surface.cssVar, hexToOklchCss(v))
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs"
          aria-label="Hex color"
          spellCheck={false}
        />
      </div>
    </div>
  )
}
