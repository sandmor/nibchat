export const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434"
export const OLLAMA_CLOUD_BASE_URL = "https://ollama.com"

export type OllamaHostMode = "local" | "cloud"

export function isOllamaCloudUrl(value?: string | null): boolean {
  const raw = value?.trim()
  if (!raw) return false
  try {
    const host = new URL(raw).hostname.replace(/^www\./i, "").toLowerCase()
    return host === "ollama.com"
  } catch {
    return false
  }
}

export function ollamaHostMode(baseUrl?: string | null): OllamaHostMode {
  return isOllamaCloudUrl(baseUrl) ? "cloud" : "local"
}

/** Local and Cloud presets the form may write. Custom URLs are left alone. */
export function isOllamaPresetUrl(value?: string | null): boolean {
  const raw = value?.trim()
  if (!raw) return false
  if (isOllamaCloudUrl(raw)) return true
  try {
    return ollamaBaseUrl(raw) === OLLAMA_DEFAULT_BASE_URL
  } catch {
    return false
  }
}

export function applyOllamaHostMode(
  baseUrl: string,
  mode: OllamaHostMode
): string {
  if (mode === "cloud") {
    return OLLAMA_CLOUD_BASE_URL
  }
  return isOllamaCloudUrl(baseUrl) ? "" : baseUrl
}

/**
 * Resolve an Ollama URL. Profiles store the server root rather than an
 * API prefix so one value can serve both native catalog and OpenAI-compatible
 * generation endpoints.
 */
export function ollamaBaseUrl(value?: string | null): string {
  const raw = value?.trim() || OLLAMA_DEFAULT_BASE_URL
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error("Ollama URL must be a valid HTTP(S) URL.")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Ollama URL must use HTTP or HTTPS.")
  }
  // ollama.com redirects aliases such as www and HTTP to the apex HTTPS host.
  // Keep the credentialed request on that origin so fetch does not remove its
  // Authorization header while following the redirect.
  if (isOllamaCloudUrl(raw)) return OLLAMA_CLOUD_BASE_URL
  url.hash = ""
  url.search = ""
  url.pathname = url.pathname.replace(/\/+$/, "")
  // Accept the endpoint forms commonly pasted from Ollama documentation.
  url.pathname = url.pathname.replace(/\/(?:api|v1)$/i, "")
  return url.toString().replace(/\/$/, "")
}

export function ollamaApiUrl(
  baseUrl: string | null | undefined,
  path: "api/tags" | "v1"
): string {
  const url = new URL(ollamaBaseUrl(baseUrl))
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${path}`
  return url.toString()
}
