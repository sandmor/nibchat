import { APICallError, LoadAPIKeyError } from "ai"

const MAX_BODY_SNIPPET = 280

function snippet(text: string, max = MAX_BODY_SNIPPET): string {
  const trimmed = text.replace(/\s+/g, " ").trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}

/**
 * Owner-readable error text for self-hosted streaming. Intentionally surfaces
 * provider details that multi-tenant apps normally redact.
 */
export function formatProviderError(error: unknown): string {
  if (LoadAPIKeyError.isInstance(error)) {
    return (
      error.message ||
      "Missing API key for this provider. Set a key in Settings or the configured env var."
    )
  }
  if (APICallError.isInstance(error)) {
    const parts = [error.message || "Provider request failed"]
    if (error.statusCode != null) parts.push(`(HTTP ${error.statusCode})`)
    if (error.url) parts.push(`→ ${error.url}`)
    if (error.responseBody) {
      const body = snippet(error.responseBody)
      if (body) parts.push(body)
    }
    return parts.join(" ")
  }
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error.trim()) return error.trim()
  return "Unable to generate a response."
}
