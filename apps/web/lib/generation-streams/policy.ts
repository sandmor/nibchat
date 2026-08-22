export type GenerationStoreState = "open" | "closed" | "orphaned" | "missing"

/** How long a Redis producer fence lasts without renewal. */
export const GENERATION_LEASE_MS = 30_000
/** Adapter-owned renew interval; must stay well under the lease TTL. */
export const GENERATION_LEASE_RENEW_MS = 10_000
/**
 * A run can exist in the database before its stream store is opened.
 * Attach and reconcile treat `starting` + missing store as that hand-off
 * until this grace expires.
 */
export const GENERATION_STARTING_HANDOFF_MS = 15_000
/** Bounded wait inside one attach GET before returning 425. */
export const GENERATION_ATTACH_WAIT_MS = 5_000
export const GENERATION_ATTACH_POLL_MS = 250
/** Idle Redis subscribers GET meta/lease on this interval; they do not XRANGE. */
export const GENERATION_REDIS_IDLE_POLL_MS = 250

export const FOLLOWABLE_RUN_STATES = [
  "starting",
  "active",
  "cancel_requested",
] as const

export type FollowableRunState = (typeof FOLLOWABLE_RUN_STATES)[number]
export type GenerationRunState = FollowableRunState | "recovering"

export type GenerationAttachDecision =
  | "subscribe"
  | "retry"
  | "gone"
  | "unavailable"

/**
 * Live producers are defined by an open store (a renewed lease), not by
 * wall-clock age. Missing stores are a hand-off only while still starting.
 */
export function shouldReconcileGeneration(
  run: { state: GenerationRunState; startedAt: string },
  snapshot: { state: GenerationStoreState },
  now = Date.now()
): boolean {
  if (snapshot.state === "open") return false
  if (snapshot.state === "closed" || snapshot.state === "orphaned") return true
  if (run.state === "starting") {
    return now - Date.parse(run.startedAt) > GENERATION_STARTING_HANDOFF_MS
  }
  return true
}

export function decideGenerationAttach(input: {
  run: { state: GenerationRunState; startedAt: string } | null
  snapshot: { state: GenerationStoreState }
  now?: number
}): GenerationAttachDecision {
  if (!input.run) return "gone"
  if (input.snapshot.state === "open") return "subscribe"
  if (input.snapshot.state === "closed" || input.snapshot.state === "orphaned")
    return "unavailable"
  if (input.run.state === "starting") {
    const now = input.now ?? Date.now()
    if (now - Date.parse(input.run.startedAt) <= GENERATION_STARTING_HANDOFF_MS)
      return "retry"
  }
  return "unavailable"
}

export function revertRecoveryState(
  previous: GenerationRunState
): FollowableRunState {
  if (previous === "cancel_requested") return "cancel_requested"
  if (previous === "starting") return "starting"
  return "active"
}
