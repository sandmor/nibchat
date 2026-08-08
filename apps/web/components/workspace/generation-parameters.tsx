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
import type { ModelConfigLocal } from "./types"

export function GenerationParameters({
  config: existing,
  chatId,
  onChange,
}: {
  config: ModelConfigLocal
  chatId?: string
  onChange: (config: ModelConfigLocal) => void | Promise<void>
}) {
  const replayId = useId()
  const [open, setOpen] = useState(false)
  const [config, setConfig] = useState(existing)
  const [stopText, setStopText] = useState(
    (existing.stopSequences ?? []).join(", ")
  )
  const [optionsText, setOptionsText] = useState(
    JSON.stringify(existing.providerOptions ?? {}, null, 2)
  )
  const [pending, setPending] = useState(false)

  async function save() {
    let providerOptions = config.providerOptions
    try {
      providerOptions = JSON.parse(optionsText) as Record<string, unknown>
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
      providerOptions,
      stopSequences: stopSequences.length ? stopSequences : undefined,
    }
    setPending(true)
    try {
      await onChange(next)
      setOpen(false)
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="sm" className="shrink-0" />}
      >
        <span className="sm:hidden">Params</span>
        <span className="hidden sm:inline">Parameters</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
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
