import {
  parseProviderModelsJson,
  resolveModelLabel,
  type ProviderModel,
} from "@/lib/provider-models"
import type { MessageStatus } from "@/lib/types"

export type MessageOrigin = {
  providerId: string | null
  providerName: string | null
  modelId: string | null
  modelName: string | null
}

export type MessageTime = {
  compact: string
  full: string
}

type ProviderRef = {
  id: string
  name: string
  models_json: string
}

const IMPORT_SOURCE_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  sillytavern: "SillyTavern",
}

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>()
const providerModelsCache = new Map<string, ProviderModel[]>()
const FORMATTER_CACHE_LIMIT = 32
const PROVIDER_MODELS_CACHE_LIMIT = 128

function boundedCacheSet<K, V>(
  cache: Map<K, V>,
  key: K,
  value: V,
  limit: number
) {
  cache.set(key, value)
  while (cache.size > limit) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return value
}

function dateTimeFormatter(
  locale: string | undefined,
  timeZone: string | undefined,
  kind: "day" | "year" | "time" | "date" | "date-year" | "full"
) {
  const key = `${locale ?? ""}\u0000${timeZone ?? ""}\u0000${kind}`
  const cached = dateTimeFormatters.get(key)
  if (cached) return cached

  const options: Intl.DateTimeFormatOptions =
    kind === "day"
      ? { timeZone, year: "numeric", month: "numeric", day: "numeric" }
      : kind === "year"
        ? { timeZone, year: "numeric" }
        : kind === "time"
          ? { timeZone, hour: "numeric", minute: "2-digit" }
          : kind === "date"
            ? {
                timeZone,
                hour: "numeric",
                minute: "2-digit",
                month: "short",
                day: "numeric",
              }
            : kind === "date-year"
              ? {
                  timeZone,
                  hour: "numeric",
                  minute: "2-digit",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }
              : { timeZone, dateStyle: "full", timeStyle: "short" }

  return boundedCacheSet(
    dateTimeFormatters,
    key,
    new Intl.DateTimeFormat(locale, options),
    FORMATTER_CACHE_LIMIT
  )
}

function cachedProviderModels(json: string) {
  const cached = providerModelsCache.get(json)
  if (cached) return cached
  return boundedCacheSet(
    providerModelsCache,
    json,
    parseProviderModelsJson(json),
    PROVIDER_MODELS_CACHE_LIMIT
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  return text || null
}

export function joinMessageMeta(
  ...parts: Array<string | null | undefined>
): string {
  return parts.filter((part): part is string => Boolean(part)).join(", ")
}

function parsedTimeMs(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function priorGenerationMs(metadata: Record<string, unknown>): number {
  return typeof metadata.generationMs === "number" &&
    Number.isFinite(metadata.generationMs) &&
    metadata.generationMs > 0
    ? metadata.generationMs
    : 0
}

/** Add the open segment (startedAt → endedAt) onto any earlier paused segments. */
export function accumulateGenerationMs(
  metadata: Record<string, unknown>,
  endedAt: string
): number | null {
  const started = parsedTimeMs(metadata.startedAt)
  const extra =
    started == null
      ? 0
      : Math.max(0, (parsedTimeMs(endedAt) ?? started) - started)
  const total = priorGenerationMs(metadata) + extra
  return total > 0 ? total : null
}

export function generationDurationMs(
  metadata: Record<string, unknown>
): number | null {
  const stored = priorGenerationMs(metadata)
  if (stored > 0) return stored
  const started = parsedTimeMs(metadata.startedAt)
  const ended =
    parsedTimeMs(metadata.finishedAt) ??
    parsedTimeMs(metadata.errorAt) ??
    parsedTimeMs(metadata.pausedAt)
  if (started == null || ended == null || ended < started) return null
  return ended - started
}

export function formatGenerationDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return seconds === 60
    ? `${minutes + 1}m`
    : seconds === 0
      ? `${minutes}m`
      : `${minutes}m ${seconds}s`
}

export function effectiveMessageStatus(
  status: MessageStatus,
  liveStream: boolean
): MessageStatus {
  if (liveStream && (status === "complete" || status === "streaming"))
    return "streaming"
  return status
}

export function messageStatusLabel(status: MessageStatus): string | null {
  switch (status) {
    case "complete":
      return null
    case "streaming":
      return "streaming"
    case "awaiting_input":
      return "waiting for input"
    case "stopped":
      return "stopped"
    case "error":
      return "error"
  }
}

export function formatMessageTime(
  iso: string,
  options?: { now?: Date; locale?: string; timeZone?: string }
): MessageTime | null {
  const created = new Date(iso)
  if (Number.isNaN(created.valueOf())) return null
  const now = options?.now ?? new Date()
  const locale = options?.locale
  const timeZone = options?.timeZone
  const dayStamp = dateTimeFormatter(locale, timeZone, "day")
  const yearStamp = dateTimeFormatter(locale, timeZone, "year")
  const sameDay = dayStamp.format(created) === dayStamp.format(now)
  const sameYear = yearStamp.format(created) === yearStamp.format(now)
  const compact = dateTimeFormatter(
    locale,
    timeZone,
    sameDay ? "time" : sameYear ? "date" : "date-year"
  ).format(created)
  const full = dateTimeFormatter(locale, timeZone, "full").format(created)
  return { compact, full }
}

function importSourceLabel(source: string) {
  return IMPORT_SOURCE_LABELS[source] ?? source
}

export function resolveMessageOrigin(
  metadata: Record<string, unknown>,
  providers: readonly ProviderRef[]
): MessageOrigin {
  const imported = asRecord(metadata.import)
  const providerId = asNonEmptyString(metadata.provider)
  const modelId =
    asNonEmptyString(metadata.model) ?? asNonEmptyString(imported?.sourceModel)
  const provider = providerId
    ? providers.find((candidate) => candidate.id === providerId)
    : undefined
  const importSource = asNonEmptyString(imported?.source)
  const sourceApi = asNonEmptyString(imported?.sourceApi)
  const providerName = provider
    ? provider.name
    : (providerId ??
      sourceApi ??
      (importSource ? importSourceLabel(importSource) : null))
  const modelName = modelId
    ? (resolveModelLabel(
        cachedProviderModels(provider?.models_json ?? "[]"),
        modelId
      ) ?? modelId)
    : null
  return {
    providerId,
    providerName,
    modelId,
    modelName,
  }
}

export function messageOriginLabel(origin: MessageOrigin): string | null {
  const label = joinMessageMeta(origin.providerName, origin.modelName)
  return label || null
}
