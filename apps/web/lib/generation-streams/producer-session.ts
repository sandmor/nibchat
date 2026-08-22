import "server-only"
import type {
  GenerationProducer,
  GenerationStreamPort,
} from "@/lib/generation-streams/ports"

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
      .catch((error) => console.error("[nibchat/generation-cancel]", error))
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
