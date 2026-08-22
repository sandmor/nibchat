import { isOllamaCloudUrl, ollamaApiUrl } from "@/lib/ollama"

export type CatalogModel = { id: string; name: string }

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
  apiKey?: string | null,
  fetchFn: FetchLike = fetch
): Promise<CatalogModel[]> {
  const url = ollamaApiUrl(profile.base_url, "api/tags")
  // A local/custom Ollama server must never receive a key retained from an
  // earlier Cloud configuration.
  const token = isOllamaCloudUrl(profile.base_url) ? apiKey?.trim() : undefined
  let response: Response
  try {
    response = await fetchFn(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
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
