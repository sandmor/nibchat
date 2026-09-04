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
      signal: AbortSignal.timeout(8000),
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
