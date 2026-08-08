import "server-only"

/**
 * Process-local registry of in-flight generations keyed by assistant node id.
 * Structural delete aborts here.
 *
 * Abort only affects generations running in this Node process. In multi-process
 * deployments (multiple workers, horizontal scale), structural delete on one
 * instance will not cancel a stream owned by another; a shared abort channel
 * is required for that.
 */
const controllers = new Map<string, AbortController>()

/**
 * Register a generation. If this nodeId was already registered, abort the
 * previous controller first (regenerate/retry safety).
 */
export function registerGeneration(
  nodeId: string,
  controller: AbortController
): void {
  const previous = controllers.get(nodeId)
  if (previous && previous !== controller) previous.abort()
  controllers.set(nodeId, controller)
}

export function unregisterGeneration(nodeId: string): void {
  controllers.delete(nodeId)
}

/** Abort and drop each registered generation. Returns how many were aborted. */
export function abortGenerations(nodeIds: Iterable<string>): number {
  let count = 0
  for (const nodeId of nodeIds) {
    const controller = controllers.get(nodeId)
    if (!controller) continue
    controllers.delete(nodeId)
    controller.abort()
    count += 1
  }
  return count
}

/** Test helper — clear all registrations between cases. */
export function clearActiveGenerations(): void {
  controllers.clear()
}

/** Test helper — whether nodeId is currently registered. */
export function isGenerationActive(nodeId: string): boolean {
  return controllers.has(nodeId)
}
