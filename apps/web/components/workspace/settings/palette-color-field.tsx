"use client"

import { useState } from "react"
import { OklchPicker } from "@/components/ui/oklch-picker"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useAppearanceColorPreview } from "@/hooks/use-appearance-color-preview"
import { formatOklch, oklchToHex } from "@/lib/appearance-color"
import { useAppearanceStore } from "@/lib/appearance-store"

export function PaletteColorField({
  label,
  value,
  ensureTheme,
  preview,
  onRemove,
  align = "start",
}: {
  label: string
  value: string
  ensureTheme: () => void
  preview: (literal: string) => void
  onRemove?: () => void
  align?: "start" | "end"
}) {
  const [open, setOpen] = useState(false)
  const commitPreview = useAppearanceStore((s) => s.commitPreview)
  const discardPreview = useAppearanceStore((s) => s.discardPreview)
  const picker = useAppearanceColorPreview({
    source: value,
    publish(literal) {
      ensureTheme()
      preview(literal)
    },
    commit: commitPreview,
    discard: discardPreview,
  })
  const hex = oklchToHex(picker.color).toUpperCase()
  const color = formatOklch(picker.color)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) picker.commit()
        setOpen(next)
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Edit ${label} palette color`}
            className="group grid min-w-0 grid-cols-[2rem_1fr] items-center gap-x-2 rounded-xl border border-input-border bg-input/20 p-2 text-left transition-[background-color,border-color,box-shadow] outline-none hover:bg-input/45 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 data-popup-open:border-ring data-popup-open:bg-input/40 data-popup-open:ring-[3px] data-popup-open:ring-ring/20"
          />
        }
      >
        <span
          className="row-span-2 size-8 rounded-lg shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--palette-ink)_12%,transparent)] transition-transform group-hover:scale-[1.04]"
          style={{ background: color }}
          aria-hidden
        />
        <span className="min-w-0 truncate text-xs font-medium">{label}</span>
        <span className="min-w-0 truncate font-mono text-[10px] tracking-tight text-muted-foreground">
          {hex}
        </span>
      </PopoverTrigger>
      <PopoverContent
        data-magic-chrome
        align={align}
        sideOffset={8}
        className="w-[19rem] gap-3 p-3.5"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{label}</p>
            <p className="text-[11px] text-muted-foreground">Palette color</p>
          </div>
          <span className="rounded-md bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">
            {hex}
          </span>
        </div>
        <OklchPicker
          value={picker.color}
          onChange={picker.change}
          onChangeEnd={picker.commit}
          compact
        />
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start text-muted-foreground"
            onClick={() => {
              picker.discard()
              setOpen(false)
              onRemove()
            }}
          >
            Remove from palette
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
