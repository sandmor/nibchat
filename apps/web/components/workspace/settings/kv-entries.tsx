"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export type KvEntry = {
  name: string
  value: string
}

export function KvEntriesEditor({
  label,
  entries,
  onChange,
  namePlaceholder = "Name",
  valuePlaceholder = "Value or ${ENV_NAME}",
  addLabel = "Add row",
}: {
  label: string
  entries: KvEntry[]
  onChange: (entries: KvEntry[]) => void
  namePlaceholder?: string
  valuePlaceholder?: string
  addLabel?: string
}) {
  return (
    <div className="space-y-2 sm:col-span-2">
      <Label>{label}</Label>
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
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange(entries.filter((_, i) => i !== index))}
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
      >
        {addLabel}
      </Button>
      <p className="text-xs text-muted-foreground">
        Values may embed <code>{`\${ENV_NAME}`}</code> templates resolved at
        connect time. Literal secrets are stored server-side and redacted after
        save; leave a secret value blank when editing to keep the stored one.
      </p>
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
