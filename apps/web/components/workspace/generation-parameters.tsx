"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { hasCustomReasoning, withReasoning } from "@/lib/reasoning"
import {
  SAMPLING_SETTING_KEYS,
  SETTING_LABELS,
  type SamplingSettingKey,
  type SettingLocks,
  type SettingValues,
} from "@/lib/chat-settings"
import type { ModelConfigLocal } from "./types"
import { SpaceLockHint } from "./space-lock-hint"
import { SamplingSettingControl } from "./settings-fields/sampling-fields"

const NUMBER_FIELDS = [
  "temperature",
  "maxOutputTokens",
  "topP",
  "frequencyPenalty",
  "presencePenalty",
] as const satisfies readonly SamplingSettingKey[]

export function GenerationParameters({
  open,
  onOpenChange,
  config: existing,
  inherited,
  chatId,
  onChange,
  locks,
  defaults = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: ModelConfigLocal
  /** Values used when this layer clears its overrides. */
  inherited?: ModelConfigLocal
  chatId?: string
  onChange: (config: ModelConfigLocal) => void | Promise<void>
  locks?: SettingLocks
  defaults?: boolean
}) {
  const [config, setConfig] = useState(existing)
  const [pending, setPending] = useState(false)
  const [draftOpen, setDraftOpen] = useState(open)

  if (open !== draftOpen) {
    setDraftOpen(open)
    if (open) setConfig(existing)
  }

  function patch(
    field: SamplingSettingKey,
    value: SettingValues[SamplingSettingKey]
  ) {
    setConfig((current) => {
      const next = { ...current }
      if (value === undefined) delete next[field]
      else Object.assign(next, { [field]: value })
      return next
    })
  }

  async function save(nextConfig: ModelConfigLocal, replaceReasoning = false) {
    const providerOptions = nextConfig.providerOptions
    if (
      providerOptions &&
      (typeof providerOptions !== "object" || Array.isArray(providerOptions))
    ) {
      toast.error("Provider JSON is invalid")
      return
    }
    const next = {
      ...nextConfig,
      reasoning: replaceReasoning ? nextConfig.reasoning : existing.reasoning,
    }
    setPending(true)
    try {
      await onChange(
        hasCustomReasoning(next.providerOptions) ? withReasoning(next) : next
      )
      onOpenChange(false)
      toast.success(
        defaults
          ? "Chat defaults saved"
          : chatId
            ? "Settings applied"
            : "Settings set for this conversation"
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not apply parameters"
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(36rem,calc(100dvh-2rem))] gap-3 overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Chat settings</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
          {NUMBER_FIELDS.map((field) => (
            <div key={field} className="grid gap-1">
              <Label className="text-[11px]" htmlFor={`gen-${field}`}>
                {SETTING_LABELS[field]}
              </Label>
              <SamplingSettingControl
                id={`gen-${field}`}
                field={field}
                value={config[field]}
                disabled={Boolean(locks?.[field])}
                commit="change"
                onChange={(value) => patch(field, value)}
              />
              <SpaceLockHint lock={locks?.[field]} />
            </div>
          ))}
        </div>
        {SAMPLING_SETTING_KEYS.filter(
          (field) =>
            !NUMBER_FIELDS.includes(field as (typeof NUMBER_FIELDS)[number])
        ).map((field) => (
          <div key={field} className="grid gap-1.5">
            {field === "contextScanDepth" || field === "stopSequences" ? (
              <Label className="text-[11px]">{SETTING_LABELS[field]}</Label>
            ) : null}
            <SamplingSettingControl
              field={field}
              value={config[field]}
              disabled={Boolean(locks?.[field])}
              commit="change"
              onChange={(value) => patch(field, value)}
            />
            <SpaceLockHint lock={locks?.[field]} />
          </div>
        ))}
        {inherited ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setConfig(inherited)
              void save(inherited, true)
            }}
          >
            Use default
          </Button>
        ) : null}
        <Button
          onClick={() => void save(config)}
          className="w-full"
          disabled={pending}
        >
          {defaults
            ? "Save chat defaults"
            : chatId
              ? "Apply to this chat"
              : "Use for this chat"}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
