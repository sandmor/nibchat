"use client"

import { useEffect, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { MAX_COLLECTION, generationCountInRange } from "@/lib/limits"

/** Steps the slider draws. Higher counts are typed in the field. */
const GENERATION_SLIDER_STEPS = 8

export function GenerationCountField({
  id,
  value,
  onChange,
  label = "Replies",
  min = 1,
}: {
  id: string
  value: number
  onChange: (count: number) => void
  label?: string
  min?: number
}) {
  const sliderMax = Math.min(
    MAX_COLLECTION,
    Math.max(min, GENERATION_SLIDER_STEPS)
  )
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (Number.isInteger(value) ? String(value) : "")
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          inputMode="numeric"
          className="h-7 w-14 px-2 text-center text-sm tabular-nums"
          value={shown}
          onChange={(event) => {
            const next = event.target.value
            if (next !== "" && !/^\d+$/.test(next)) return
            if (next !== "" && Number(next) > MAX_COLLECTION) return
            setDraft(next)
            if (next === "") return
            onChange(Number(next))
          }}
          onBlur={() => setDraft(null)}
        />
      </div>
      <Slider
        aria-label={`${label}, up to ${sliderMax}`}
        min={min}
        max={sliderMax}
        step={1}
        value={[clampCount(value, min, sliderMax)]}
        onValueChange={(next) => {
          const count = Array.isArray(next) ? next[0] : next
          if (typeof count !== "number") return
          setDraft(null)
          onChange(count)
        }}
      />
    </div>
  )
}

function clampCount(value: number, min: number, max: number) {
  if (!Number.isInteger(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function MultipleGenerationsDialog({
  open,
  onOpenChange,
  onConfirm,
  verb = "Generate",
  min = 2,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (count: number) => void
  verb?: string
  min?: number
}) {
  const fieldId = useId()
  const [count, setCount] = useState(min)
  const valid = generationCountInRange(count, min)
  useEffect(() => {
    if (open) setCount(min)
  }, [open, min])
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>How many replies?</DialogTitle>
          <DialogDescription>
            Each reply is its own branch.
          </DialogDescription>
        </DialogHeader>
        <GenerationCountField
          id={fieldId}
          value={count}
          onChange={setCount}
          min={min}
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!valid}
            onClick={() => {
              onOpenChange(false)
              onConfirm(count)
            }}
          >
            {verb} {count} replies
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
