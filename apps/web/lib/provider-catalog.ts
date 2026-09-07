import { ollamaApiUrl } from "@/lib/ollama"

/** Wire protocols supported by OpenAI-compatible provider profiles. */
export type ProviderProtocol = "responses" | "chat"

export function isProviderProtocol(value: unknown): value is ProviderProtocol {
  return value === "responses" || value === "chat"
}

/** Server-only cache payload. Endpoint URLs are deliberately never returned to clients. */
export type CatalogModel = {
  id: string
  name: string
  protocol?: ProviderProtocol
  endpoint?: string
  learnedProtocol?: ProviderProtocol
  learnedAt?: string
}

export function publicCatalogModels(models: CatalogModel[]) {
  return models.map(({ id, name, protocol, learnedProtocol }) => {
    const effectiveProtocol = isProviderProtocol(learnedProtocol)
      ? learnedProtocol
      : isProviderProtocol(protocol)
        ? protocol
        : undefined
    return {
      id,
      name,
      ...(effectiveProtocol ? { protocol: effectiveProtocol } : {}),
    }
  })
}

/**
 * Model catalogs are provider-controlled configuration. Recognize known AI SDK
 * adapters, but never dynamically import a package named by a remote catalog.
 */
export function protocolFromCatalogEntry(entry: unknown): {
  protocol?: ProviderProtocol
  endpoint?: string
} {
  if (!entry || typeof entry !== "object") return {}
  const record = entry as Record<string, unknown>
  const api = asRecord(record.api) ?? asRecord(record.provider)
  const npm = typeof api?.npm === "string" ? api.npm : undefined
  const endpoint = typeof api?.url === "string" ? api.url : undefined
  const protocol: ProviderProtocol | undefined =
    npm === "@ai-sdk/open-responses" || npm === "@ai-sdk/openai"
      ? "responses"
      : npm === "@ai-sdk/openai-compatible"
        ? "chat"
        : undefined
  return protocol ? { protocol, ...(endpoint ? { endpoint } : {}) } : {}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

type OllamaCatalogProfile = {
  name: string
  base_url: string | null
}

type FetchLike = typeof fetch

const MODELS_DEV_URL = "https://models.dev/api.json"
const CATALOG_TIMEOUT_MS = 8000

/** First-party SDK hosts. models.dev omits `api` for these npm packages. */
export const DEFAULT_PROVIDER_API_URL = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
} as const

const WELL_KNOWN_API_BY_NPM: Record<string, string> = {
  "@ai-sdk/openai": DEFAULT_PROVIDER_API_URL.openai,
  "@ai-sdk/anthropic": DEFAULT_PROVIDER_API_URL.anthropic,
}

/** Join `{base}/models` without dropping a `/v1` prefix (URL resolution quirk). */
export function openaiCompatibleModelsUrl(baseUrl: string): string {
  const raw = baseUrl.trim()
  if (!raw) {
    throw new Error(
      "OpenAI-compatible provider needs a base URL before its catalog can be loaded."
    )
  }
  try {
    return new URL("models", raw.endsWith("/") ? raw : `${raw}/`).toString()
  } catch {
    throw new Error("OpenAI-compatible base URL must be a valid HTTP(S) URL.")
  }
}

export function resolvedProviderBaseUrl(
  kind: string,
  baseUrl?: string | null
): string | undefined {
  const configured = baseUrl?.trim()
  if (configured) return configured
  if (kind === "openai") return DEFAULT_PROVIDER_API_URL.openai
  if (kind === "anthropic") return DEFAULT_PROVIDER_API_URL.anthropic
}

/**
 * Compare configured gateways to models.dev `api` values. Strips trailing
 * slashes and `/models` or protocol paths so a pasted completions URL still
 * matches the provider root.
 */
export function normalizeCatalogApiUrl(value: string): string | undefined {
  const raw = value.trim()
  if (!raw || raw.includes("${")) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    url.hash = ""
    url.search = ""
    url.username = ""
    url.password = ""
    url.hostname = url.hostname.toLowerCase()
    url.pathname = url.pathname
      .replace(/\/+$/, "")
      .replace(/\/(models|chat\/completions|responses)$/i, "")
    return url.toString().replace(/\/$/, "")
  } catch {
    return undefined
  }
}

/** Live `/models` for an OpenAI-compatible (or Anthropic-style list) host. */
export async function discoverOpenAICompatibleModels(
  baseUrl: string | null | undefined,
  headers: Record<string, string> = {},
  fetchFn: FetchLike = fetch
): Promise<CatalogModel[]> {
  const url = openaiCompatibleModelsUrl(baseUrl ?? "")
  let response: Response
  try {
    response = await fetchFn(url, {
      headers,
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    })
  } catch (error) {
    const detail =
      error instanceof Error && error.message ? `: ${error.message}` : ""
    throw new Error(`Could not connect to ${url}${detail}`)
  }

  const payload = await response.json().catch(() => undefined)
  if (!response.ok) {
    const detail = messageFromPayload(payload)
    throw new Error(
      `Compatible catalog request failed (HTTP ${response.status}) at ${url}${
        detail ? `: ${detail}` : ""
      }`
    )
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { data?: unknown }).data)
  ) {
    throw new Error("Provider returned an invalid model catalog.")
  }

  const seen = new Set<string>()
  return (payload as { data: Array<unknown> }).data.flatMap((model) => {
    if (!model || typeof model !== "object") return []
    const record = model as {
      id?: unknown
      name?: unknown
      display_name?: unknown
    }
    const id = typeof record.id === "string" ? record.id.trim() : ""
    if (!id || seen.has(id)) return []
    seen.add(id)
    const name =
      typeof record.name === "string" && record.name.trim()
        ? record.name
        : typeof record.display_name === "string" && record.display_name.trim()
          ? record.display_name
          : id
    return [{ id, name, ...protocolFromCatalogEntry(model) }]
  })
}

type ModelsDevProvider = {
  api?: unknown
  npm?: unknown
  models?: unknown
}

/**
 * Select the models.dev family whose `api` (or well-known npm host) matches
 * the configured provider URL. Kind is only a tie-break, never the lookup key.
 */
export function modelsDevCatalogForUrl(
  payload: unknown,
  baseUrl: string,
  preferredProviderId?: string
): CatalogModel[] | undefined {
  const target = normalizeCatalogApiUrl(baseUrl)
  if (!target || !payload || typeof payload !== "object") return undefined
  const matches: Array<{ id: string; provider: ModelsDevProvider }> = []
  for (const [id, value] of Object.entries(
    payload as Record<string, unknown>
  )) {
    if (!value || typeof value !== "object") continue
    const provider = value as ModelsDevProvider
    const api = catalogApiUrl(provider)
    if (api && normalizeCatalogApiUrl(api) === target)
      matches.push({ id, provider })
  }
  if (!matches.length) return undefined
  const selected =
    (preferredProviderId
      ? matches.find((item) => item.id === preferredProviderId)
      : undefined) ??
    matches.slice().sort((left, right) => left.id.localeCompare(right.id))[0]!
  return catalogModelsFromDevProvider(selected.provider)
}

function catalogApiUrl(provider: ModelsDevProvider): string | undefined {
  if (typeof provider.api === "string" && provider.api.trim())
    return provider.api.trim()
  if (typeof provider.npm === "string")
    return WELL_KNOWN_API_BY_NPM[provider.npm]
}

function catalogModelsFromDevProvider(
  provider: ModelsDevProvider
): CatalogModel[] {
  const models = asRecord(provider.models)
  if (!models) return []
  const inherited = protocolFromNpm(provider.npm)
  return Object.entries(models).flatMap(([id, value]) => {
    if (!id) return []
    const model = asRecord(value) ?? {}
    const override = asRecord(model.provider)
    const protocol = override ? protocolFromNpm(override.npm) : inherited
    const name =
      typeof model.name === "string" && model.name.trim() ? model.name : id
    return [{ id, name, ...protocol }]
  })
}

function protocolFromNpm(npm: unknown) {
  return typeof npm === "string"
    ? protocolFromCatalogEntry({ api: { npm } })
    : {}
}

async function tryFetchModelsDevCatalog(
  fetchFn: FetchLike
): Promise<unknown | undefined> {
  try {
    const response = await fetchFn(MODELS_DEV_URL, {
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    return await response.json().catch(() => undefined)
  } catch {
    return undefined
  }
}

/**
 * Live `/models` first. models.dev is a fallback keyed by the provider URL
 */
export async function discoverProviderCatalog(
  profile: { kind: string; name: string },
  config: { baseUrl?: string | null },
  headers: Record<string, string> = {},
  fetchFn: FetchLike = fetch
): Promise<CatalogModel[]> {
  if (profile.kind === "ollama") {
    return discoverOllamaModels(
      { name: profile.name, base_url: config.baseUrl ?? null },
      headers,
      fetchFn
    )
  }
  const baseUrl = resolvedProviderBaseUrl(profile.kind, config.baseUrl)
  if (profile.kind === "openai-compatible" && !baseUrl) {
    throw new Error(
      "OpenAI-compatible provider needs a base URL before its catalog can be loaded."
    )
  }

  let liveError: Error | undefined
  if (baseUrl) {
    try {
      const live = await discoverOpenAICompatibleModels(
        baseUrl,
        headers,
        fetchFn
      )
      if (live.length) return live
    } catch (error) {
      liveError =
        error instanceof Error ? error : new Error("Model discovery failed")
    }
  }

  if (baseUrl) {
    const fallback = modelsDevCatalogForUrl(
      await tryFetchModelsDevCatalog(fetchFn),
      baseUrl,
      profile.kind === "openai" || profile.kind === "anthropic"
        ? profile.kind
        : undefined
    )
    if (fallback) return fallback
  }

  if (liveError) throw liveError
  return []
}

function messageFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined
  const error = (payload as { error?: unknown }).error
  return typeof error === "string" && error.trim() ? error.trim() : undefined
}

/** Discover models installed on, or offered by, an Ollama host. */
export async function discoverOllamaModels(
  profile: OllamaCatalogProfile,
  headers: Record<string, string> = {},
  fetchFn: FetchLike = fetch
): Promise<CatalogModel[]> {
  const url = ollamaApiUrl(profile.base_url, "api/tags")
  let response: Response
  try {
    response = await fetchFn(url, {
      headers,
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    })
  } catch (error) {
    const detail =
      error instanceof Error && error.message ? `: ${error.message}` : ""
    throw new Error(`Could not connect to Ollama at ${url}${detail}`)
  }

  const payload = await response.json().catch(() => undefined)
  if (!response.ok) {
    const detail = messageFromPayload(payload)
    throw new Error(
      `Ollama catalog request failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`
    )
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { models?: unknown }).models)
  ) {
    throw new Error("Ollama returned an invalid model catalog.")
  }

  const seen = new Set<string>()
  return (
    payload as { models: Array<{ model?: unknown; name?: unknown }> }
  ).models.flatMap((model) => {
    const id =
      typeof model.model === "string" && model.model.trim()
        ? model.model.trim()
        : typeof model.name === "string" && model.name.trim()
          ? model.name.trim()
          : ""
    if (!id || seen.has(id)) return []
    seen.add(id)
    return [{ id, name: id }]
  })
}
