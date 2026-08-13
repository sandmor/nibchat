"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { TooltipProvider, WithTooltip } from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  parseProviderModelsJson,
  pickerModels,
  resolveModelLabel,
} from "@/lib/provider-models"
import type { CatalogModel, ModelConfigLocal, ProviderSummary } from "./types"
import { useMediaMdUp } from "./hooks"

function modelsForProvider(
  provider: ProviderSummary,
  selectedProviderId?: string,
  selectedModel?: string
): CatalogModel[] {
  const parsed = parseProviderModelsJson(provider.models_json)
  const models = pickerModels(parsed)
  if (
    selectedProviderId === provider.id &&
    selectedModel &&
    !models.some((model) => model.id === selectedModel)
  ) {
    models.unshift({
      id: selectedModel,
      name: resolveModelLabel(parsed, selectedModel) ?? selectedModel,
    })
  }
  return models
}

function joinLabel(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(" / ")
}

export function ModelPicker({
  config: existing,
  chatId,
  providers,
  showIds = false,
  onChange,
}: {
  config: ModelConfigLocal
  chatId?: string
  providers: ProviderSummary[]
  showIds?: boolean
  onChange: (config: ModelConfigLocal) => void | Promise<void>
}) {
  const router = useRouter()
  const mdUp = useMediaMdUp()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [pending, setPending] = useState(false)

  const selectedProvider = providers.find((p) => p.id === existing.providerId)
  const modelId = existing.model
  const displayName =
    resolveModelLabel(
      parseProviderModelsJson(selectedProvider?.models_json ?? "[]"),
      modelId
    ) ?? modelId
  const modelShort = displayName
    ? displayName.includes("/")
      ? displayName.slice(displayName.lastIndexOf("/") + 1)
      : displayName
    : null
  const fullLabel = joinLabel([selectedProvider?.name, displayName]) || "Model"
  const tooltipLabel =
    showIds && modelId && displayName && modelId !== displayName
      ? joinLabel([fullLabel, modelId])
      : fullLabel
  const compactLabel = modelShort ?? selectedProvider?.name ?? "Model"

  function setPickerOpen(next: boolean) {
    setOpen(next)
    if (next) setQuery("")
  }

  const q = query.trim().toLowerCase()
  const groups = providers
    .map((provider) => {
      const models = modelsForProvider(
        provider,
        existing.providerId,
        existing.model
      ).filter((m) => {
        if (!q) return true
        return (
          m.id.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          provider.name.toLowerCase().includes(q)
        )
      })
      return { provider, models }
    })
    .filter((g) => g.models.length > 0)

  async function pick(providerId: string, model: string) {
    setPending(true)
    try {
      await onChange({ ...existing, providerId, model })
      setOpen(false)
      setQuery("")
      toast.success(
        chatId ? "Model applied" : "Model set for this conversation"
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not apply model"
      )
    } finally {
      setPending(false)
    }
  }

  const listBody = (
    <>
      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models"
          aria-label="Search models"
          className="flex-1"
          autoFocus={mdUp}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!providers.length ? (
          <div className="px-1 py-6 text-center text-sm text-muted-foreground">
            <p>No providers configured.</p>
            <Button
              variant="link"
              className="mt-1"
              onClick={() => {
                setOpen(false)
                router.push("/settings")
              }}
            >
              Manage providers
            </Button>
          </div>
        ) : !groups.length ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            {q
              ? "No models match."
              : "No models are enabled. Turn models on in Settings."}
          </p>
        ) : (
          <div className="space-y-3 py-1">
            {groups.map(({ provider, models }) => (
              <div key={provider.id}>
                <p className="mb-1 px-2 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                  {provider.name}
                </p>
                <div className="space-y-0.5">
                  {models.map((model) => {
                    const selected =
                      existing.providerId === provider.id &&
                      existing.model === model.id
                    return (
                      <button
                        key={model.id}
                        type="button"
                        disabled={pending}
                        className={cn(
                          "flex w-full min-w-0 flex-col rounded-lg px-2 py-2 text-left text-sm transition hover:bg-muted",
                          selected && "bg-muted"
                        )}
                        onClick={() => void pick(provider.id, model.id)}
                      >
                        <span className="truncate font-medium">
                          {model.name}
                        </span>
                        {showIds && model.name !== model.id ? (
                          <span className="truncate text-[11px] text-muted-foreground">
                            {model.id}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t pt-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={() => {
            setPickerOpen(false)
            router.push("/settings")
          }}
        >
          Manage providers
        </Button>
      </div>
    </>
  )

  if (!mdUp) {
    return (
      <TooltipProvider delay={400}>
        <WithTooltip label={tooltipLabel}>
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 flex-1 justify-start truncate px-2"
            onClick={() => setPickerOpen(true)}
            aria-label={`Model: ${tooltipLabel}`}
          >
            <span className="truncate">{compactLabel}</span>
          </Button>
        </WithTooltip>
        <Dialog open={open} onOpenChange={setPickerOpen}>
          <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col gap-3 rounded-none border-0 p-4 sm:h-auto sm:max-h-[90svh] sm:max-w-md sm:rounded-2xl sm:border">
            <DialogHeader>
              <DialogTitle>Choose model</DialogTitle>
            </DialogHeader>
            <div className="flex min-h-0 flex-1 flex-col gap-3">{listBody}</div>
          </DialogContent>
        </Dialog>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider delay={400}>
      <Popover open={open} onOpenChange={setPickerOpen}>
        <WithTooltip label={tooltipLabel}>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="max-w-[min(18rem,40vw)] min-w-0 truncate"
                aria-label={`Model: ${tooltipLabel}`}
              />
            }
          >
            <span className="truncate">{fullLabel}</span>
          </PopoverTrigger>
        </WithTooltip>
        <PopoverContent
          align="end"
          className="flex max-h-[min(28rem,70vh)] w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 p-3"
        >
          {listBody}
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  )
}
