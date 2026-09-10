"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { BrainIcon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { TooltipProvider, WithTooltip } from "@/components/ui/tooltip"
import { parseProviderModelsJson } from "@/lib/provider-models"
import {
  clearCustomReasoning,
  hasCustomReasoning,
  reasoningLabel,
  reasoningRequest,
  reasoningSupport,
  selectedReasoning,
  withReasoning,
  type ReasoningSelection,
} from "@/lib/reasoning"
import { cn } from "@/lib/utils"
import type { ModelConfigLocal, ProviderSummary } from "./types"
import { useMediaMdUp } from "./hooks"

function choiceKey(choice?: ReasoningSelection) {
  return choice ? JSON.stringify(choice) : "default"
}

function sameChoice(a?: ReasoningSelection, b?: ReasoningSelection) {
  return choiceKey(a) === choiceKey(b)
}

function triggerLabel(selection?: ReasoningSelection, custom?: boolean) {
  if (custom) return "Custom"
  if (selection?.type === "budget")
    return selection.tokens.toLocaleString("en-US")
  return reasoningLabel(selection)
}

function requestProtocol(
  kind: string,
  modelProtocol?: string
): "responses" | "chat" | "anthropic" {
  if (kind === "anthropic") return "anthropic"
  if (modelProtocol === "chat" || modelProtocol === "responses")
    return modelProtocol
  return "responses"
}

export function ReasoningPicker({
  config,
  providers,
  onChange,
  onEditParameters,
}: {
  config: ModelConfigLocal
  providers: ProviderSummary[]
  onChange: (config: ModelConfigLocal) => void | Promise<void>
  onEditParameters: () => void
}) {
  const router = useRouter()
  const mdUp = useMediaMdUp()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [budget, setBudget] = useState("8192")
  const provider = providers.find((item) => item.id === config.providerId)
  const model = parseProviderModelsJson(provider?.models_json ?? "[]").find(
    (item) => item.id === config.model
  )
  const kind = provider?.reasoningKind ?? undefined
  const support = reasoningSupport(kind, config.model ?? "", model?.reasoning)
  const selection = selectedReasoning(config)
  const custom =
    hasCustomReasoning(config.providerOptions) || support?.format === "custom"
  const label = triggerLabel(selection, custom)
  const managed =
    support && support.format !== "unsupported" && support.format !== "custom"
  if (!provider || !config.model || (!managed && !custom && !selection))
    return null

  const protocol = requestProtocol(provider.kind, model?.protocol)
  let invalid: string | undefined
  if (selection && !custom) {
    try {
      reasoningRequest(support, selection, protocol, config)
    } catch (error) {
      invalid =
        error instanceof Error ? error.message : "Select a supported level."
    }
  }

  function setPickerOpen(next: boolean) {
    if (next && selection?.type === "budget")
      setBudget(String(selection.tokens))
    setOpen(next)
  }

  async function apply(next?: ReasoningSelection, clearCustom = false) {
    setPending(true)
    try {
      reasoningRequest(support, next, protocol, config)
      await onChange(
        withReasoning(
          {
            ...config,
            ...(clearCustom
              ? {
                  providerOptions: clearCustomReasoning(config.providerOptions),
                }
              : {}),
          },
          next
        )
      )
      setPickerOpen(false)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not set reasoning"
      )
    } finally {
      setPending(false)
    }
  }

  const choices: Array<ReasoningSelection | undefined> = [undefined]
  if (support?.format === "effort" || support?.format === "adaptive")
    choices.push(
      ...support.levels.map((effort) => ({ type: "effort" as const, effort }))
    )
  if (support?.format === "toggle")
    choices.push({ type: "off" }, { type: "on" })
  if (support?.format === "budget")
    choices.push(
      { type: "off" },
      ...[2048, 8192, 16384].map((tokens) => ({
        type: "budget" as const,
        tokens,
      }))
    )

  const hint = custom
    ? "Provider JSON is controlling reasoning for this model."
    : support?.format === "budget"
      ? "Thinking tokens must stay below Max output."
      : support?.format === "unsupported"
        ? "Reasoning is disabled for this model. Choose Default to clear the saved override."
        : !support
          ? "Configure a reasoning format for this endpoint in Settings."
          : "Applies to the next reply. Default sends no override."

  const panel = (
    <>
      {custom ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{hint}</p>
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={() => {
              setPickerOpen(false)
              onEditParameters()
            }}
          >
            Edit provider JSON
          </Button>
          {selection && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={pending}
              onClick={() => void apply()}
            >
              Clear saved reasoning selection
            </Button>
          )}
          {support?.format !== "custom" && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={pending}
              onClick={() => void apply(undefined, true)}
            >
              Use managed controls
            </Button>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{hint}</p>
          <div
            className="-mx-1 flex flex-col gap-0.5"
            role="group"
            aria-label="Reasoning choices"
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button"
                )
              )
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement
              )
              event.preventDefault()
              buttons[
                (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                  buttons.length
              ]?.focus()
            }}
          >
            {choices.map((choice) => {
              const selected = sameChoice(choice, selection)
              return (
                <button
                  key={choiceKey(choice)}
                  type="button"
                  disabled={pending}
                  aria-pressed={selected}
                  className={cn(
                    "flex w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-muted",
                    selected && "bg-muted"
                  )}
                  onClick={() => void apply(choice)}
                >
                  {reasoningLabel(choice)}
                </button>
              )
            })}
          </div>
          {support?.format === "budget" && (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void apply({ type: "budget", tokens: Number(budget) })
              }}
            >
              <Input
                type="number"
                min={1024}
                step={1}
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
                aria-label="Custom thinking token budget"
                className="min-w-0"
                required
              />
              <Button
                type="submit"
                size="sm"
                className="shrink-0"
                disabled={pending}
              >
                Set
              </Button>
            </form>
          )}
          {invalid && (
            <p role="alert" className="text-xs text-danger">
              {invalid}
            </p>
          )}
        </>
      )}
      <div className="flex items-center justify-end border-t pt-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={() => {
            setPickerOpen(false)
            router.push("/settings")
          }}
        >
          Model settings
        </Button>
      </div>
    </>
  )

  const triggerClassName =
    "max-w-[6.5rem] min-w-0 shrink-0 gap-1 px-2 sm:max-w-[9rem] sm:px-3"
  const triggerIcon = (
    <HugeiconsIcon
      icon={BrainIcon}
      strokeWidth={1.8}
      className="size-3.5"
      aria-hidden="true"
    />
  )

  if (!mdUp) {
    return (
      <TooltipProvider delay={400}>
        <WithTooltip label={`Reasoning · ${label}`}>
          <Button
            variant="ghost"
            size="sm"
            className={triggerClassName}
            aria-label={`Reasoning: ${label}`}
            onClick={() => setPickerOpen(true)}
          >
            {triggerIcon}
            <span className="truncate">{label}</span>
          </Button>
        </WithTooltip>
        <Dialog open={open} onOpenChange={setPickerOpen}>
          <DialogContent className="max-h-[min(36rem,calc(100dvh-2rem))] w-[calc(100%-2rem)] max-w-sm gap-3 overflow-y-auto p-4">
            <DialogHeader className="gap-1">
              <DialogTitle>Reasoning</DialogTitle>
              <DialogDescription className="sr-only">{hint}</DialogDescription>
            </DialogHeader>
            {panel}
          </DialogContent>
        </Dialog>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider delay={400}>
      <Popover open={open} onOpenChange={setPickerOpen}>
        <WithTooltip label={`Reasoning · ${label}`}>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className={triggerClassName}
                aria-label={`Reasoning: ${label}`}
              />
            }
          >
            {triggerIcon}
            <span className="truncate">{label}</span>
          </PopoverTrigger>
        </WithTooltip>
        <PopoverContent
          align="end"
          className="max-h-[min(28rem,calc(100dvh-6rem))] w-[min(18rem,calc(100vw-2rem))] gap-3 overflow-y-auto p-3"
        >
          <p className="text-sm font-medium">Reasoning</p>
          {panel}
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  )
}
