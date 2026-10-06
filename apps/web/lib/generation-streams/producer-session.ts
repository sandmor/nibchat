import "server-only"
import type {
  GenerationProducer,
  GenerationStreamPort,
} from "@/lib/generation-streams/ports"
import { logDiagnosticFailure } from "@/lib/diagnostics"

const CANCEL_POLL_MS = 250

/**
 * Cancellation is a store signal, independent of HTTP subscribers.
 * Lease renewal belongs to the stream adapter (`open` → `close`), not here.
 */
export function startProducerGuards(
  store: GenerationStreamPort,
  producer: GenerationProducer,
  onCancel: () => void
): { stop: () => void } {
  let stopped = false
  const poll = () => {
    if (stopped) return
    void store
      .isCancelled(producer.generationId)
      .then((cancelled) => {
        if (!stopped && cancelled) onCancel()
      })
      .catch((error) =>
        logDiagnosticFailure("generation.cancel_poll_failed", error, "warn", {
          generationId: producer.generationId,
        })
      )
  }
  poll()
  const timer = setInterval(poll, CANCEL_POLL_MS)
  timer.unref?.()
  return {
    stop() {
      if (stopped) return
      stopped = true
      clearInterval(timer)
    },
  }
}
