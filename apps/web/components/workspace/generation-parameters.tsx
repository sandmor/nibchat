"use client"

import { useId, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { hasCustomReasoning, withReasoning } from "@/lib/reasoning"
import type { ModelConfigLocal } from "./types"

export function GenerationParameters({
  open,
  onOpenChange,
  config: existing,
  chatId,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: ModelConfigLocal
  chatId?: string
  onChange: (config: ModelConfigLocal) => void | Promise<void>
}) {
  const replayId = useId()
  const [config, setConfig] = useState(existing)
  const [stopText, setStopText] = useState(
    (existing.stopSequences ?? []).join(", ")
  )
  const [optionsText, setOptionsText] = useState(
    JSON.stringify(existing.providerOptions ?? {}, null, 2)
  )
  const [pending, setPending] = useState(false)
  const [draftOpen, setDraftOpen] = useState(open)

  if (open !== draftOpen) {
    setDraftOpen(open)
    if (open) {
      setConfig(existing)
      setOptionsText(JSON.stringify(existing.providerOptions ?? {}, null, 2))
      setStopText((existing.stopSequences ?? []).join(", "))
    }
  }

  async function save() {
    let providerOptions = config.providerOptions
    try {
      const parsed: unknown = JSON.parse(optionsText)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Expected a JSON object")
      providerOptions = parsed as Record<string, unknown>
    } catch {
      toast.error("Provider JSON is invalid")
      return
    }
    const stopSequences = stopText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    const next = {
      ...config,
      reasoning: existing.reasoning,
      providerOptions,
      stopSequences: stopSequences.length ? stopSequences : undefined,
    }
    setPending(true)
    try {
      await onChange(
        hasCustomReasoning(providerOptions) ? withReasoning(next) : next
      )
      onOpenChange(false)
      toast.success(
        chatId ? "Parameters applied" : "Parameters set for this conversation"
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
    <Popover
      open={open}
      onOpenChange={onOpenChange}
    >
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm" className="shrink-0 px-2 sm:px-3" />
        }
      >
        <span className="sm:hidden">Params</span>
        <span className="hidden sm:inline">Parameters</span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[min(36rem,calc(100dvh-6rem))] w-[min(20rem,calc(100vw-2rem))] gap-3 overflow-y-auto p-3"
      >
        <p className="text-sm font-medium">Generation parameters</p>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["temperature", "Temperature"],
              ["maxOutputTokens", "Max output"],
              ["topP", "Top P"],
              ["frequencyPenalty", "Frequency"],
              ["presencePenalty", "Presence"],
            ] as const
          ).map(([field, label]) => (
            <div key={field} className="grid gap-1">
              <Label className="text-[11px]" htmlFor={`gen-${field}`}>
                {label}
              </Label>
              <Input
                id={`gen-${field}`}
                type="number"
                value={config[field] ?? ""}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    [field]:
                      event.target.value === ""
                        ? undefined
                        : Number(event.target.value),
                  })
                }
              />
            </div>
          ))}
        </div>
        <div className="grid gap-1.5">
          <Label className="text-[11px]" htmlFor="gen-stop">
            Stop sequences
          </Label>
          <Input
            id="gen-stop"
            value={stopText}
            onChange={(e) => setStopText(e.target.value)}
            placeholder="comma-separated"
          />
        </div>
        <Textarea
          value={optionsText}
          onChange={(e) => setOptionsText(e.target.value)}
          rows={4}
          className="font-mono text-xs"
          aria-label="Provider-specific JSON"
        />
        <div className="flex items-center gap-2">
          <Switch
            id={replayId}
            checked={config.replayReasoning ?? true}
            onCheckedChange={(checked) =>
              setConfig({ ...config, replayReasoning: checked })
            }
          />
          <Label htmlFor={replayId} className="text-xs text-muted-foreground">
            Replay saved reasoning when supported
          </Label>
        </div>
        <Button
          onClick={() => void save()}
          className="w-full"
          disabled={pending}
        >
          {chatId ? "Apply to this chat" : "Use for next message"}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
