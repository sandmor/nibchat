"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { InformationCircleIcon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TooltipProvider, WithTooltip } from "@/components/ui/tooltip"

export type KvEntry = {
  name: string
  value: string
}

const ENV_TEMPLATE_HELP =
  "Embed ${ENV_NAME} in a value to resolve it from the server environment at connect time."

export function KvEntriesEditor({
  label,
  entries,
  onChange,
  namePlaceholder = "Name",
  valuePlaceholder = "Value or ${ENV_NAME}",
  addLabel = "Add row",
  disabled = false,
}: {
  label: string
  entries: KvEntry[]
  onChange: (entries: KvEntry[]) => void
  namePlaceholder?: string
  valuePlaceholder?: string
  addLabel?: string
  disabled?: boolean
}) {
  return (
    <div className="space-y-2 sm:col-span-2">
      <div className="flex items-center gap-1.5">
        <Label className="mb-0">{label}</Label>
        <TooltipProvider delay={200}>
          <WithTooltip side="top" label={ENV_TEMPLATE_HELP}>
            <button
              type="button"
              className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
              aria-label={`About ${label.toLowerCase()} environment templates`}
            >
              <HugeiconsIcon
                icon={InformationCircleIcon}
                className="size-3.5"
                strokeWidth={2}
              />
            </button>
          </WithTooltip>
        </TooltipProvider>
      </div>
      <div className="space-y-2">
        {entries.map((entry, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <Input
              className="min-w-[8rem] flex-1"
              value={entry.name}
              onChange={(event) => {
                const next = [...entries]
                next[index] = { ...entry, name: event.target.value }
                onChange(next)
              }}
              placeholder={namePlaceholder}
              disabled={disabled}
              aria-label={`${label} name ${index + 1}`}
            />
            <Input
              className="min-w-[12rem] flex-[2]"
              value={entry.value}
              onChange={(event) => {
                const next = [...entries]
                next[index] = { ...entry, value: event.target.value }
                onChange(next)
              }}
              placeholder={valuePlaceholder}
              autoComplete="off"
              disabled={disabled}
              aria-label={`${label} value ${index + 1}`}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange(entries.filter((_, i) => i !== index))}
              disabled={disabled}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => onChange([...entries, { name: "", value: "" }])}
        disabled={disabled}
      >
        {addLabel}
      </Button>
    </div>
  )
}

export function StringListEditor({
  label,
  values,
  onChange,
  placeholder = "argument",
  addLabel = "Add argument",
}: {
  label: string
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  addLabel?: string
}) {
  return (
    <div className="space-y-2 sm:col-span-2">
      <Label>{label}</Label>
      <div className="space-y-2">
        {values.map((value, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={value}
              onChange={(event) => {
                const next = [...values]
                next[index] = event.target.value
                onChange(next)
              }}
              placeholder={placeholder}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange(values.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => onChange([...values, ""])}
      >
        {addLabel}
      </Button>
    </div>
  )
}
