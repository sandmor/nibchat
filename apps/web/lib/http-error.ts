/** Map thrown domain/auth errors to HTTP status for REST route handlers. */

import {
  OWNER_FORBIDDEN_MESSAGE,
  UNAUTHORIZED_MESSAGE,
} from "@/lib/auth-messages"

export function statusFromError(error: unknown): number {
  if (!(error instanceof Error)) return 400
  if (error.message === UNAUTHORIZED_MESSAGE) return 401
  if (error.message === OWNER_FORBIDDEN_MESSAGE) return 403
  return 400
}

export function jsonError(
  error: unknown,
  fallback = "Request failed"
): Response {
  const message = error instanceof Error ? error.message : fallback
  return Response.json(
    { error: message || fallback },
    { status: statusFromError(error) }
  )
}
