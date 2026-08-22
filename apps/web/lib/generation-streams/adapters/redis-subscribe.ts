import type { GenerationEvent } from "@/lib/generation-streams/ports"

export type RedisGenerationMeta = {
  token: string
  status: "open" | "closed"
  seq: number
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done, { once: true })
  })

/**
 * Follow a Redis-backed log without ranging while idle. `seq` is the only
 * wake signal; XRANGE runs only after it changes (or on the first catch-up).
 */
export async function* followRedisGenerationLog(input: {
  after: string | null
  signal: AbortSignal
  pollMs: number
  readMeta: () => Promise<RedisGenerationMeta | null>
  readLease: () => Promise<string | null>
  readPage: (after: string | null) => Promise<GenerationEvent[]>
}): AsyncGenerator<GenerationEvent> {
  let cursor = input.after
  let seenSeq = -1
  while (!input.signal.aborted) {
    const meta = await input.readMeta()
    if (!meta) return
    if (meta.seq !== seenSeq) {
      const page = await input.readPage(cursor)
      if (page.length) {
        for (const event of page) {
          cursor = event.cursor
          yield event
        }
        continue
      }
      seenSeq = meta.seq
      continue
    }
    if (meta.status !== "open") return
    if ((await input.readLease()) !== meta.token) return
    await pause(input.pollMs, input.signal)
  }
}
