"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import {
  filterProviderModels,
  parseProviderCatalogPayload,
  removeCustomModel,
  setModelsEnabled,
  upsertCustomModel,
  type CatalogModel,
  type ModelVisibilityFilter,
  type ProviderModel,
} from "@/lib/provider-models"

const VISIBILITY_ITEMS: { id: ModelVisibilityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "on", label: "On" },
  { id: "off", label: "Off" },
]

/** Used only until the first mounted row is measured. */
const FALLBACK_ROW_HEIGHT = 74

function ModelRow({
  model,
  custom,
  disabled,
  onToggle,
  onAlias,
  onRemove,
}: {
  model: ProviderModel
  custom: boolean
  disabled: boolean
  onToggle: (enabled: boolean) => void
  onAlias: (label: string) => void
  onRemove: () => void
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 border-b border-foreground/6 px-3 py-2.5",
        model.enabled ? "bg-transparent" : "opacity-80"
      )}
    >
      <Switch
        size="sm"
        className="mt-1"
        checked={model.enabled}
        disabled={disabled}
        onCheckedChange={onToggle}
        aria-label={`Show ${model.id} in chats`}
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="truncate font-mono text-[12px] leading-tight text-muted-foreground">
          {model.id}
          {custom ? (
            <span className="ml-2 font-sans text-[10px] tracking-wide uppercase">
              custom
            </span>
          ) : null}
        </p>
        <Input
          value={model.label}
          onChange={(event) => onAlias(event.target.value)}
          aria-label={`Alias for ${model.id}`}
          placeholder="Alias"
          disabled={disabled}
          className="h-8 rounded-xl text-sm"
        />
      </div>
      {custom ? (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="mt-0.5 text-muted-foreground"
          disabled={disabled}
          onClick={onRemove}
        >
          Remove
        </Button>
      ) : null}
    </div>
  )
}

export function ProviderModelsEditor({
  providerId,
  models,
  catalog,
  onModelsChange,
  onCatalogChange,
  onLoadingChange,
  disabled = false,
  refreshOnMount = false,
}: {
  providerId: string | null
  models: ProviderModel[]
  catalog: CatalogModel[]
  onModelsChange: (models: ProviderModel[]) => void
  onCatalogChange: (catalog: CatalogModel[]) => void
  onLoadingChange?: (loading: boolean) => void
  disabled?: boolean
  refreshOnMount?: boolean
}) {
  const [query, setQuery] = useState("")
  const [visibility, setVisibility] = useState<ModelVisibilityFilter>("all")
  const [customId, setCustomId] = useState("")
  const [loading, setLoading] = useState(() => Boolean(providerId))
  const modelsRef = useRef(models)
  const abortRef = useRef<AbortController | null>(null)
  const refreshOnMountRef = useRef(refreshOnMount)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sampleHeightRef = useRef<number | null>(null)
  const [sampleHeight, setSampleHeight] = useState<number | null>(null)
  modelsRef.current = models
  refreshOnMountRef.current = refreshOnMount

  const enabledCount = models.filter((model) => model.enabled).length
  const filtered = useMemo(
    () => filterProviderModels(models, query, visibility),
    [models, query, visibility]
  )
  const filteredIds = useMemo(
    () => new Set(filtered.map((model) => model.id)),
    [filtered]
  )
  const filteredOn = filtered.filter((model) => model.enabled).length

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => sampleHeight ?? FALLBACK_ROW_HEIGHT,
    overscan: 8,
    getItemKey: (index) => filtered[index]?.id ?? index,
  })
  const virtualizerRef = useRef(virtualizer)
  virtualizerRef.current = virtualizer

  const measureRow = useCallback((element: HTMLElement | null) => {
    virtualizerRef.current.measureElement(element)
  }, [])

  const virtualItems = virtualizer.getVirtualItems()
  useLayoutEffect(() => {
    if (sampleHeightRef.current != null || virtualItems.length === 0) return
    const row = scrollRef.current?.querySelector("[data-index]")
    if (!(row instanceof HTMLElement)) return
    const height = row.getBoundingClientRect().height
    if (height <= 0) return
    sampleHeightRef.current = height
    setSampleHeight(height)
  }, [virtualItems.length])

  useEffect(() => {
    onLoadingChange?.(loading)
  }, [loading, onLoadingChange])

  const loadCatalog = useCallback(
    async (refresh: boolean, notify = refresh) => {
      if (!providerId) {
        toast.error("Save the provider first to load its catalog.")
        return
      }
      abortRef.current?.abort()
      const abort = new AbortController()
      abortRef.current = abort
      setLoading(true)
      try {
        const url = `/api/models?providerId=${encodeURIComponent(providerId)}${
          refresh ? "&refresh=1" : ""
        }`
        const res = await fetch(url, { signal: abort.signal })
        const { models: next, error } = parseProviderCatalogPayload(
          await res.json().catch(() => ({}))
        )
        if (abort.signal.aborted) return
        if (error) {
          toast.error(error)
          return
        }
        // A successful empty response is authoritative; a failed response is not.
        onCatalogChange(next)
        if (notify) {
          toast.success(
            next.length
              ? `Loaded ${next.length} catalog model${next.length === 1 ? "" : "s"}`
              : "Catalog is empty"
          )
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return
        toast.error(
          error instanceof Error ? error.message : "Could not load catalog"
        )
      } finally {
        if (!abort.signal.aborted) setLoading(false)
      }
    },
    [onCatalogChange, providerId]
  )

  useEffect(() => {
    if (!providerId) return
    void loadCatalog(refreshOnMountRef.current, false)
    return () => abortRef.current?.abort()
  }, [loadCatalog, providerId])

  function addCustom() {
    if (disabled) return
    const result = upsertCustomModel(modelsRef.current, customId)
    if (!customId.trim()) return
    if (result.status === "exists") {
      toast.message("That model is already on and in the list.")
      return
    }
    onModelsChange(result.models)
    setCustomId("")
    if (result.status === "enabled") toast.success("Model turned on")
  }

  const controlsDisabled = disabled || loading

  return (
    <div className="space-y-3 sm:col-span-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Label>Models in chats</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Only enabled models appear in the chat picker. Aliases are labels,
            not API ids.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {enabledCount} on
          {models.length ? ` · ${models.length} listed` : ""}
          {catalog.length ? ` · ${catalog.length} in catalog` : ""}
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-xl bg-muted/40 p-3 ring-1 ring-foreground/8">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by model id or alias…"
            aria-label="Filter models and aliases"
            disabled={disabled}
            className="min-w-[12rem] flex-1"
          />
          <div className="flex rounded-4xl bg-background p-0.5 ring-1 ring-foreground/10">
            {VISIBILITY_ITEMS.map((item) => (
              <Button
                key={item.id}
                type="button"
                size="xs"
                variant={visibility === item.id ? "secondary" : "ghost"}
                aria-pressed={visibility === item.id}
                disabled={disabled}
                onClick={() => setVisibility(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={
              controlsDisabled ||
              filtered.length === 0 ||
              filteredOn === filtered.length
            }
            onClick={() =>
              onModelsChange(setModelsEnabled(models, filteredIds, true))
            }
          >
            Enable {query.trim() || visibility !== "all" ? "filtered" : "all"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={
              controlsDisabled || filtered.length === 0 || filteredOn === 0
            }
            onClick={() =>
              onModelsChange(setModelsEnabled(models, filteredIds, false))
            }
          >
            Disable {query.trim() || visibility !== "all" ? "filtered" : "all"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={controlsDisabled || !providerId}
            onClick={() => void loadCatalog(true)}
          >
            {loading ? "Loading catalog…" : "Refresh catalog"}
          </Button>
        </div>
        {(query.trim() || visibility !== "all") && (
          <p className="text-[11px] text-muted-foreground">
            {filtered.length} matching · {filteredOn} on
          </p>
        )}

        <div
          ref={scrollRef}
          className="max-h-[min(28rem,60vh)] overflow-y-auto overscroll-contain rounded-lg bg-background/80 ring-1 ring-foreground/8"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {models.length === 0
                ? providerId
                  ? "No models yet. Refresh the catalog or add an id."
                  : "Add a model id, or save the provider to load its catalog."
                : "No models match this filter."}
            </p>
          ) : (
            <ul
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualItems.map((virtualRow) => {
                const model = filtered[virtualRow.index]
                if (!model) return null
                const custom = model.source === "custom"
                return (
                  <li
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={measureRow}
                    className="absolute top-0 left-0 w-full"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <ModelRow
                      model={model}
                      custom={custom}
                      disabled={disabled}
                      onToggle={(enabled) =>
                        onModelsChange(
                          models.map((entry) =>
                            entry.id === model.id
                              ? { ...entry, enabled }
                              : entry
                          )
                        )
                      }
                      onAlias={(label) =>
                        onModelsChange(
                          models.map((entry) =>
                            entry.id === model.id ? { ...entry, label } : entry
                          )
                        )
                      }
                      onRemove={() =>
                        onModelsChange(removeCustomModel(models, model.id))
                      }
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="provider-add-model">Add model ID</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="provider-add-model"
            value={customId}
            onChange={(event) => setCustomId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                addCustom()
              }
            }}
            placeholder="provider/model-id"
            disabled={disabled}
            className="min-w-[12rem] flex-1"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={addCustom}
            disabled={disabled}
          >
            Add model
          </Button>
        </div>
      </div>
    </div>
  )
}
