"use client"

import { useEffect, useId, useState } from "react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  SAMPLING_SETTING_KEYS,
  SETTING_LABELS,
  type SamplingSettingKey,
  type SettingValues,
} from "@/lib/chat-settings"
import { ScanDepthField } from "../scan-depth-field"

function SamplingNumberField({
  id,
  label,
  value,
  disabled = false,
  commit = "blur",
  onCommit,
}: {
  id?: string
  label: string
  value: number | undefined
  disabled?: boolean
  commit?: "blur" | "change"
  onCommit: (value: number | undefined) => void
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value))
  useEffect(() => {
    setText(value === undefined ? "" : String(value))
  }, [value])

  function publish(raw: string) {
    if (raw.trim() === "") {
      onCommit(undefined)
      return
    }
    const next = Number(raw)
    if (!Number.isFinite(next)) {
      setText(value === undefined ? "" : String(value))
      return
    }
    if (next === value) return
    onCommit(next)
  }

  return (
    <Input
      id={id}
      type="number"
      aria-label={label}
      disabled={disabled}
      value={text}
      onChange={(event) => {
        setText(event.target.value)
        if (commit === "change") publish(event.target.value)
      }}
      onBlur={() => {
        if (commit === "blur") publish(text)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
      }}
    />
  )
}

function StopSequencesField({
  value,
  disabled = false,
  commit = "blur",
  onCommit,
}: {
  value: string[]
  disabled?: boolean
  commit?: "blur" | "change"
  onCommit: (value: string[]) => void
}) {
  const committed = value.join(", ")
  const [text, setText] = useState(committed)
  useEffect(() => {
    setText(committed)
  }, [committed])

  function publish(raw: string) {
    const next = raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
    if (next.join(", ") === committed) return
    onCommit(next)
  }

  return (
    <Input
      value={text}
      disabled={disabled}
      placeholder="comma-separated"
      aria-label={SETTING_LABELS.stopSequences}
      onChange={(event) => {
        setText(event.target.value)
        if (commit === "change") publish(event.target.value)
      }}
      onBlur={() => {
        if (commit === "blur") publish(text)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
      }}
    />
  )
}

function ProviderOptionsField({
  value,
  disabled = false,
  commit = "blur",
  onCommit,
}: {
  value: Record<string, unknown>
  disabled?: boolean
  commit?: "blur" | "change"
  onCommit: (value: Record<string, unknown>) => void
}) {
  const committed = JSON.stringify(value ?? {}, null, 2)
  const [text, setText] = useState(committed)
  useEffect(() => {
    setText(committed)
  }, [committed])

  function commitText(raw: string, revert: boolean) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Expected a JSON object")
      }
      const next = parsed as Record<string, unknown>
      if (JSON.stringify(next) === JSON.stringify(value ?? {})) return
      onCommit(next)
    } catch {
      if (!revert) return
      toast.error("Provider JSON is invalid")
      setText(committed)
    }
  }

  return (
    <Textarea
      className="font-mono text-xs"
      rows={4}
      value={text}
      disabled={disabled}
      onChange={(event) => {
        setText(event.target.value)
        if (commit === "change") commitText(event.target.value, false)
      }}
      onBlur={() => commitText(text, true)}
      aria-label={SETTING_LABELS.providerOptions}
    />
  )
}

function BooleanSettingField({
  field,
  checked,
  disabled = false,
  onCheckedChange,
}: {
  field: "replayReasoning" | "expandMessageMacros"
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const id = useId()
  const label =
    field === "replayReasoning"
      ? "Replay saved reasoning when supported"
      : "Expand macros in messages"
  return (
    <div className="flex items-center gap-2">
      <Switch
        id={id}
        disabled={disabled}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
    </div>
  )
}

export function SamplingSettingControl({
  id,
  field,
  value,
  disabled = false,
  commit = "blur",
  onChange,
}: {
  id?: string
  field: SamplingSettingKey
  value: SettingValues[SamplingSettingKey]
  disabled?: boolean
  commit?: "blur" | "change"
  onChange: (value: SettingValues[SamplingSettingKey]) => void
}) {
  if (field === "contextScanDepth") {
    return (
      <ScanDepthField
        compact
        value={value as number | null | undefined}
        disabled={disabled}
        onChange={(next) => onChange(next)}
      />
    )
  }
  if (field === "stopSequences") {
    return (
      <StopSequencesField
        value={(value as string[] | undefined) ?? []}
        disabled={disabled}
        commit={commit}
        onCommit={(next) => onChange(next)}
      />
    )
  }
  if (field === "providerOptions") {
    return (
      <ProviderOptionsField
        value={(value as Record<string, unknown> | undefined) ?? {}}
        disabled={disabled}
        commit={commit}
        onCommit={(next) => onChange(next)}
      />
    )
  }
  if (field === "replayReasoning" || field === "expandMessageMacros") {
    return (
      <BooleanSettingField
        field={field}
        checked={field === "replayReasoning" ? value !== false : Boolean(value)}
        disabled={disabled}
        onCheckedChange={(checked) => onChange(checked)}
      />
    )
  }
  return (
    <SamplingNumberField
      id={id}
      label={SETTING_LABELS[field]}
      value={typeof value === "number" ? value : undefined}
      disabled={disabled}
      commit={commit}
      onCommit={(next) => onChange(next)}
    />
  )
}
