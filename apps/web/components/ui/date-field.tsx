"use client"

import { useState } from "react"
import { DayPicker } from "react-day-picker"
import { HugeiconsIcon } from "@hugeicons/react"
import { Calendar03Icon } from "@hugeicons/core-free-icons"
import { Label } from "./label"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

/** Calendar dates are local calendar values, never UTC-midnight instants. */
export function DateField({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = value ? new Date(`${value}T12:00:00`) : undefined
  const valid =
    selected && !Number.isNaN(selected.getTime()) ? selected : undefined
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return (
    <div className="grid gap-1.5">
      <Label id={`${id}-label`} htmlFor={id}>
        Date
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          id={id}
          type="button"
          aria-labelledby={`${id}-label ${id}-value`}
          data-theme-group="input"
          data-theme-target="input"
          className="flex h-9 w-full items-center justify-between gap-1.5 rounded-4xl border border-input-border bg-input/30 px-3 text-sm transition-colors outline-none hover:bg-input/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 elevation-dark:bg-input elevation-dark:hover:bg-input"
        >
          <span id={`${id}-value`}>
            {valid
              ? new Intl.DateTimeFormat(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }).format(valid)
              : "Choose a date"}
          </span>
          <HugeiconsIcon
            icon={Calendar03Icon}
            strokeWidth={2}
            className="size-4 text-muted-foreground"
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-auto max-w-[calc(100vw-2rem)] gap-0 p-3"
        >
          <DayPicker
            mode="single"
            required
            autoFocus
            selected={valid}
            defaultMonth={valid}
            disabled={{ before: today }}
            showOutsideDays
            onSelect={(date) => {
              onChange(
                `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
              )
              setOpen(false)
            }}
            classNames={{
              root: "relative",
              months: "relative",
              month_caption: "flex h-9 items-center px-2 pr-20 font-medium",
              nav: "absolute right-0 top-0 flex gap-1",
              button_previous:
                "grid size-8 place-items-center rounded-lg hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
              button_next:
                "grid size-8 place-items-center rounded-lg hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
              chevron: "size-4 fill-current",
              month_grid: "border-collapse",
              weekday:
                "h-9 w-9 text-center text-xs font-normal text-muted-foreground",
              day: "size-9 p-0 text-center",
              day_button:
                "size-9 rounded-xl hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected:
                "[&>button]:bg-primary [&>button]:text-primary-foreground",
              today:
                "font-semibold [&>button]:ring-1 [&>button]:ring-inset [&>button]:ring-border",
              outside: "text-muted-foreground/50",
              disabled: "opacity-40",
              hidden: "invisible",
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
