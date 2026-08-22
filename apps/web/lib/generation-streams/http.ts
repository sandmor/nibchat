import "server-only"
import type { GenerationEvent } from "@/lib/generation-streams/ports"

const encoder = new TextEncoder()

/** Encode stored AI SDK UI chunks while preserving an SSE resume cursor. */
export function generationSseResponse(events: AsyncIterable<GenerationEvent>) {
  const iterator = events[Symbol.asyncIterator]()
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next()
      if (next.done) {
        controller.close()
        return
      }
      controller.enqueue(
        encoder.encode(
          `id: ${next.value.cursor}\ndata: ${JSON.stringify(next.value.payload)}\n\n`
        )
      )
    },
    async cancel() {
      await iterator.return?.()
    },
  })
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  })
}
