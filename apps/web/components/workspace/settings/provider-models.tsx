"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { AnimatePresence, motion } from "motion/react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { usePrefersReducedMotion } from "@/components/workspace/hooks"
import {
  defaultAppearance,
  motionTransition,
  shouldAnimate,
} from "@/lib/appearance"
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

type MotionTween = {
  duration: number
  ease: [number, number, number, number]
}

const MODELS_HELP =
  "Only enabled models appear in the chat picker. Aliases are labels, not API ids. For PDFs, File sends the original and Text sends extracted text."
const PROTOCOL_HELP =
  "API type chooses Chat Completions or the Responses API; Auto follows the catalog."

const VISIBILITY_ITEMS: { id: ModelVisibilityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "on", label: "On" },
  { id: "off", label: "Off" },
]

const PDF_INPUT_ITEMS: { id: ProviderModel["pdfInput"]; label: string }[] = [
  { id: "native", label: "File" },
  { id: "extracted", label: "Text" },
]
const PROTOCOL_ITEMS = [
  { id: "auto", label: "Auto" },
  { id: "responses", label: "Responses" },
  { id: "chat", label: "Chat" },
] as const

const quietToggleItemClassName = "h-6 min-w-6 px-2.5 text-xs"

function kindSupportsProtocol(kind: string) {
  return kind === "openai-compatible" || kind === "ollama"
}

function firstSelected<T extends string>(
  items: readonly { id: T }[],
  next: string[]
): T | undefined {
  return items.find((item) => item.id === next[0])?.id
}

/** Used only until the first mounted row is measured. */
const FALLBACK_ROW_HEIGHT = 74

function ModelRow({
  model,
  custom,
  disabled,
  onToggle,
  onAlias,
  onPdfInput,
  onProtocol,
  showProtocol,
  animate,
  transition,
  onRemove,
}: {
  model: ProviderModel
  custom: boolean
  disabled: boolean
  onToggle: (enabled: boolean) => void
  onAlias: (label: string) => void
  onPdfInput: (pdfInput: "native" | "extracted") => void
  onProtocol: (protocol: "auto" | "responses" | "chat") => void
  showProtocol: boolean
  animate: boolean
  transition: MotionTween
  onRemove: () => void
}) {
  const motionTween = animate ? transition : { duration: 0 }
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
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[12px] leading-tight text-muted-foreground">
          {model.id}
          {custom ? (
            <span className="ml-2 font-sans text-[10px] tracking-wide uppercase">
              custom
            </span>
          ) : null}
        </p>
        <div className="mt-1.5 flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden">
          <Input
            value={model.label}
            onChange={(event) => onAlias(event.target.value)}
            aria-label={`Alias for ${model.id}`}
            placeholder="Alias"
            disabled={disabled}
            className="h-8 min-w-0 flex-1 rounded-xl text-sm"
          />
          <ToggleGroup
            value={[model.pdfInput]}
            onValueChange={(next) => {
              const id = firstSelected(PDF_INPUT_ITEMS, next)
              if (id) onPdfInput(id)
            }}
            disabled={disabled}
            size="sm"
            spacing={1}
            className="shrink-0"
            aria-label={`PDF input for ${model.id}`}
          >
            {PDF_INPUT_ITEMS.map((item) => (
              <ToggleGroupItem
                key={item.id}
                value={item.id}
                className={quietToggleItemClassName}
                aria-label={
                  item.id === "native"
                    ? `Send original PDF for ${model.id}`
                    : `Send extracted text for ${model.id}`
                }
              >
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <AnimatePresence initial={false}>
          {showProtocol ? (
            <motion.div
              key="api-type"
              initial={animate ? { height: 0, opacity: 0 } : false}
              animate={{ height: "auto", opacity: 1 }}
              exit={animate ? { height: 0, opacity: 0 } : { height: 0 }}
              transition={motionTween}
              className="overflow-hidden"
            >
              <div className="mt-1.5 flex min-w-0 flex-nowrap items-center justify-between gap-2 overflow-hidden">
                <p className="shrink-0 text-[11px] leading-none text-muted-foreground">
                  API type
                </p>
                <ToggleGroup
                  value={[model.protocol ?? "auto"]}
                  onValueChange={(next) => {
                    const id = firstSelected(PROTOCOL_ITEMS, next)
                    if (id) onProtocol(id)
                  }}
                  disabled={disabled}
                  size="sm"
                  spacing={1}
                  className="shrink-0"
                  aria-label={`API type for ${model.id}`}
                >
                  {PROTOCOL_ITEMS.map((item) => (
                    <ToggleGroupItem
                      key={item.id}
                      value={item.id}
                      className={quietToggleItemClassName}
                    >
                      {item.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      {custom ? (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="mt-0.5 shrink-0 text-muted-foreground"
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
  providerKind,
  models,
  catalog,
  onModelsChange,
  onCatalogChange,
  defaultPdfInput,
  onLoadingChange,
  disabled = false,
  refreshOnMount = false,
  animate: animateProp,
  transition: transitionProp,
}: {
  providerId: string | null
  providerKind: string
  models: ProviderModel[]
  catalog: CatalogModel[]
  onModelsChange: (models: ProviderModel[]) => void
  onCatalogChange: (catalog: CatalogModel[]) => void
  defaultPdfInput: "native" | "extracted"
  onLoadingChange?: (loading: boolean) => void
  disabled?: boolean
  refreshOnMount?: boolean
  animate?: boolean
  transition?: MotionTween
}) {
  const [query, setQuery] = useState("")
  const [visibility, setVisibility] = useState<ModelVisibilityFilter>("all")
  const [customId, setCustomId] = useState("")
  const [loading, setLoading] = useState(() => Boolean(providerId))
  const supportsProtocol = kindSupportsProtocol(providerKind)
  const [showAdvanced, setShowAdvanced] = useState(
    () =>
      supportsProtocol &&
      models.some((model) => model.protocol && model.protocol !== "auto")
  )
  const showProtocol = supportsProtocol && showAdvanced
  const prefersReduced = usePrefersReducedMotion()
  const fallbackMotion = defaultAppearance().motion
  const animate = animateProp ?? shouldAnimate(fallbackMotion, prefersReduced)
  const transition = transitionProp ?? motionTransition(fallbackMotion)
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
    if (virtualItems.length === 0) return
    const row = scrollRef.current?.querySelector("[data-index]")
    if (!(row instanceof HTMLElement)) return
    const applyHeight = (raw: number) => {
      const height = Math.round(raw)
      if (height <= 0 || sampleHeightRef.current === height) return
      sampleHeightRef.current = height
      setSampleHeight(height)
      virtualizerRef.current.measure()
    }
    applyHeight(row.getBoundingClientRect().height)
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize?.[0]
      applyHeight(box?.blockSize ?? entries[0]?.contentRect.height ?? 0)
    })
    observer.observe(row)
    return () => observer.disconnect()
  }, [showProtocol, virtualItems.length])

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
    const result = upsertCustomModel(
      modelsRef.current,
      customId,
      defaultPdfInput
    )
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
        <div className="min-w-0">
          <Label>Models in chats</Label>
          <p className="mt-1 text-xs text-pretty text-muted-foreground">
            {MODELS_HELP}
          </p>
          <AnimatePresence initial={false}>
            {showProtocol ? (
              <motion.p
                key="protocol-help"
                initial={animate ? { height: 0, opacity: 0 } : false}
                animate={{ height: "auto", opacity: 1 }}
                exit={animate ? { height: 0, opacity: 0 } : { height: 0 }}
                transition={animate ? transition : { duration: 0 }}
                className="overflow-hidden text-xs text-pretty text-muted-foreground"
              >
                <span className="block pt-1">{PROTOCOL_HELP}</span>
              </motion.p>
            ) : null}
          </AnimatePresence>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {supportsProtocol ? (
            <div className="flex items-center gap-2">
              <Switch
                id="provider-models-advanced"
                size="sm"
                checked={showAdvanced}
                disabled={disabled}
                onCheckedChange={setShowAdvanced}
              />
              <Label
                htmlFor="provider-models-advanced"
                className="text-xs font-normal text-muted-foreground"
              >
                Advanced
              </Label>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {enabledCount} on
            {models.length ? ` · ${models.length} listed` : ""}
            {catalog.length ? ` · ${catalog.length} in catalog` : ""}
          </p>
        </div>
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
          <ToggleGroup
            value={[visibility]}
            onValueChange={(next) => {
              const id = firstSelected(VISIBILITY_ITEMS, next)
              if (id) setVisibility(id)
            }}
            disabled={disabled}
            size="sm"
            spacing={1}
            aria-label="Filter by visibility"
          >
            {VISIBILITY_ITEMS.map((item) => (
              <ToggleGroupItem
                key={item.id}
                value={item.id}
                className={quietToggleItemClassName}
              >
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
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
                      onPdfInput={(pdfInput) =>
                        onModelsChange(
                          models.map((entry) =>
                            entry.id === model.id
                              ? { ...entry, pdfInput }
                              : entry
                          )
                        )
                      }
                      onProtocol={(protocol) =>
                        onModelsChange(
                          models.map((entry) =>
                            entry.id === model.id
                              ? {
                                  ...entry,
                                  ...(protocol === "auto"
                                    ? { protocol: undefined }
                                    : { protocol }),
                                }
                              : entry
                          )
                        )
                      }
                      showProtocol={showProtocol}
                      animate={animate}
                      transition={transition}
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
