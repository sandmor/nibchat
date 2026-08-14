"use client"

import { useCallback, useRef } from "react"
import { cn } from "@/lib/utils"
import {
  cssColorToOklch,
  formatOklch,
  oklchToHex,
  type OklchColor,
} from "@/lib/appearance-color"

const MAX_CHROMA = 0.4

function colorAt(l: number, c: number, h: number): string {
  return formatOklch({ l, c, h, alpha: 1 })
}

export function OklchPicker({
  value,
  onChange,
  onChangeEnd,
  compact,
}: {
  value: OklchColor
  onChange: (next: OklchColor) => void
  onChangeEnd?: () => void
  compact?: boolean
}) {
  const planeRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)

  const pointerToPlane = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const el = planeRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = Math.min(
        1,
        Math.max(0, (event.clientX - rect.left) / rect.width)
      )
      const y = Math.min(
        1,
        Math.max(0, (event.clientY - rect.top) / rect.height)
      )
      onChange({
        ...value,
        c: x * MAX_CHROMA,
        l: 1 - y,
      })
    },
    [onChange, value]
  )

  const pointerToHue = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const el = hueRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = Math.min(
        1,
        Math.max(0, (event.clientX - rect.left) / rect.width)
      )
      onChange({ ...value, h: x * 360 })
    },
    [onChange, value]
  )

  function drag(
    event: React.PointerEvent<HTMLDivElement>,
    move: (event: React.PointerEvent<HTMLDivElement>) => void
  ) {
    event.currentTarget.setPointerCapture(event.pointerId)
    move(event)
  }

  const hex = oklchToHex(value)
  const planeX = (value.c / MAX_CHROMA) * 100
  const planeY = (1 - value.l) * 100
  const hueX = (value.h / 360) * 100

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={planeRef}
        role="slider"
        aria-label="Lightness and chroma"
        tabIndex={0}
        className={cn(
          "relative w-full cursor-crosshair touch-none overflow-hidden rounded-xl ring-1 ring-border",
          compact ? "h-36" : "h-44"
        )}
        style={{
          background: `
            linear-gradient(to bottom, oklch(1 0 0), oklch(0 0 0)),
            linear-gradient(to right, oklch(0.7 0 ${value.h}), ${colorAt(0.7, MAX_CHROMA, value.h)})
          `,
          backgroundBlendMode: "multiply",
        }}
        onPointerDown={(event) => drag(event, pointerToPlane)}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            pointerToPlane(event)
          }
        }}
        onPointerUp={onChangeEnd}
        onPointerCancel={onChangeEnd}
      >
        <span
          className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{
            left: `${planeX}%`,
            top: `${planeY}%`,
            background: formatOklch({ ...value, alpha: 1 }),
          }}
        />
      </div>
      <div
        ref={hueRef}
        role="slider"
        aria-label="Hue"
        tabIndex={0}
        className="relative h-3 w-full cursor-ew-resize touch-none overflow-hidden rounded-full ring-1 ring-border"
        style={{
          background:
            "linear-gradient(to right, oklch(0.7 0.2 0), oklch(0.7 0.2 60), oklch(0.7 0.2 120), oklch(0.7 0.2 180), oklch(0.7 0.2 240), oklch(0.7 0.2 300), oklch(0.7 0.2 360))",
        }}
        onPointerDown={(event) => drag(event, pointerToHue)}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            pointerToHue(event)
          }
        }}
        onPointerUp={onChangeEnd}
        onPointerCancel={onChangeEnd}
      >
        <span
          className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{
            left: `${hueX}%`,
            background: colorAt(0.7, 0.2, value.h),
          }}
        />
      </div>
      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        Opacity
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(value.alpha * 100)}
          onChange={(event) =>
            onChange({ ...value, alpha: Number(event.target.value) / 100 })
          }
          onPointerUp={onChangeEnd}
          onKeyUp={onChangeEnd}
          className="min-w-0 flex-1"
          aria-label="Opacity"
        />
        <span className="w-8 text-right tabular-nums">
          {Math.round(value.alpha * 100)}%
        </span>
      </label>
      <div className="flex items-center gap-2">
        <span
          className="size-8 shrink-0 rounded-md ring-1 ring-border"
          style={{ background: formatOklch(value) }}
          aria-hidden
        />
        <input
          value={hex}
          onChange={(event) => {
            const next = event.target.value
            if (/^#[0-9a-fA-F]{6}$/.test(next)) {
              onChange({ ...cssColorToOklch(next), alpha: value.alpha })
            }
          }}
          onBlur={onChangeEnd}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs"
          aria-label="Hex color"
          spellCheck={false}
        />
      </div>
    </div>
  )
}
