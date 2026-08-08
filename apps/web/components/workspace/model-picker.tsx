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
import { WithTooltip } from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { parseJson } from "@/lib/domain"
import type { CatalogModel, ModelConfigLocal, ProviderSummary } from "./types"
import { useMediaMdUp } from "./hooks"

export function ModelPicker({
  config: existing,
  chatId,
  providers,
  onChange,
}: {
  config: ModelConfigLocal
  chatId?: string
  providers: ProviderSummary[]
  onChange: (config: ModelConfigLocal) => void | Promise<void>
}) {
  const router = useRouter()
  const mdUp = useMediaMdUp()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)
  const [catalog, setCatalog] = useState<Record<string, CatalogModel[]>>(() => {
    const seed: Record<string, CatalogModel[]> = {}
    for (const p of providers) {
      seed[p.id] = parseJson<string[]>(p.models_json, []).map((id) => ({
        id,
        name: id,
      }))
    }
    return seed
  })

  const selectedProvider = providers.find((p) => p.id === existing.providerId)
  const modelId = existing.model
  const modelShort = modelId
    ? modelId.includes("/")
      ? modelId.slice(modelId.lastIndexOf("/") + 1)
      : modelId
    : null
  const fullLabel =
    selectedProvider && modelId
      ? `${selectedProvider.name} · ${modelId}`
      : selectedProvider
        ? selectedProvider.name
        : modelId
          ? modelId
          : "Model"
  const compactLabel = modelShort ?? selectedProvider?.name ?? "Model"

  async function loadCatalogs(refresh = false) {
    if (!providers.length) return
    setLoading(true)
    try {
      const results = await Promise.all(
        providers.map(async (provider) => {
          const url = `/api/models?providerId=${encodeURIComponent(provider.id)}${
            refresh ? "&refresh=1" : ""
          }`
          const res = await fetch(url)
          const payload = (await res.json().catch(() => ({}))) as {
            models?: Array<{ id: string; name?: string }>
          }
          const manual = parseJson<string[]>(provider.models_json, []).map(
            (id) => ({ id, name: id })
          )
          const discovered = Array.isArray(payload.models)
            ? payload.models.map((m) => ({
                id: m.id,
                name: m.name ?? m.id,
              }))
            : []
          const byId = new Map<string, CatalogModel>()
          for (const m of [...manual, ...discovered]) byId.set(m.id, m)
          return [provider.id, [...byId.values()]] as const
        })
      )
      setCatalog(Object.fromEntries(results) as Record<string, CatalogModel[]>)
    } finally {
      setLoading(false)
    }
  }

  function setPickerOpen(next: boolean) {
    setOpen(next)
    if (next) {
      setQuery("")
      void loadCatalogs(false)
    }
  }

  const q = query.trim().toLowerCase()
  const groups = providers
    .map((provider) => {
      const models = (catalog[provider.id] ?? []).filter((m) => {
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
          placeholder="Search models…"
          aria-label="Search models"
          className="flex-1"
          autoFocus={mdUp}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !groups.length ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            Loading models…
          </p>
        ) : !providers.length ? (
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
            No models match.
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
                        {model.name !== model.id && (
                          <span className="truncate text-[11px] text-muted-foreground">
                            {model.id}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={() => void loadCatalogs(true)}
          disabled={loading}
        >
          Refresh catalogs
        </Button>
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
      <>
        <WithTooltip label={fullLabel}>
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 flex-1 justify-start truncate px-2"
            onClick={() => setPickerOpen(true)}
            aria-label={`Model: ${fullLabel}`}
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
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setPickerOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="max-w-[min(18rem,40vw)] min-w-0 truncate"
            aria-label={`Model: ${fullLabel}`}
            title={fullLabel}
          />
        }
      >
        <span className="truncate">{fullLabel}</span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex max-h-[min(28rem,70vh)] w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 p-3"
      >
        {listBody}
      </PopoverContent>
    </Popover>
  )
}
