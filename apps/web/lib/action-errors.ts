"use client"

import { toast } from "sonner"

const reported = new WeakSet<object>()

/** Nested action handlers may observe the same failure. Notify only once. */
export function reportActionError(error: unknown, fallback = "Action failed") {
  if (typeof error === "object" && error !== null) {
    if (reported.has(error)) return
    reported.add(error)
  }
  toast.error(
    error instanceof Error && error.message.trim() ? error.message : fallback
  )
}
