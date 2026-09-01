import "server-only"
import type {
  GenerationEvent,
  GenerationProducer,
  GenerationStreamMeta,
  GenerationStreamPort,
  GenerationStreamSnapshot,
} from "@/lib/generation-streams/ports"

type Entry = {
  meta: GenerationStreamMeta
  token: string
  next: number
  events: GenerationEvent[]
  cancelled: boolean
  waiters: Set<() => void>
  closed: boolean
}

const waitForChange = (entry: Entry, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const wake = () => {
      entry.waiters.delete(wake)
      signal.removeEventListener("abort", wake)
      resolve()
    }
    entry.waiters.add(wake)
    signal.addEventListener("abort", wake, { once: true })
  })

/** Process-local, stateful implementation for a single Node process. */
export class MemoryGenerationStreamPort implements GenerationStreamPort {
  private readonly entries = new Map<string, Entry>()
  private readonly pendingCancels = new Set<string>()

  async open(meta: GenerationStreamMeta) {
    if (this.entries.has(meta.generationId))
      throw new Error("Generation stream already exists")
    const token = crypto.randomUUID()
    this.entries.set(meta.generationId, {
      meta,
      token,
      next: 1,
      events: [],
      cancelled: this.pendingCancels.delete(meta.generationId),
      waiters: new Set(),
      closed: false,
    })
    return { generationId: meta.generationId, token } satisfies GenerationProducer
  }

  async append(producer: GenerationProducer, payload: GenerationEvent["payload"]) {
    const entry = this.entries.get(producer.generationId)
    if (!entry || entry.closed || entry.token !== producer.token)
      throw new Error("Generation stream is not active")
    if (entry.cancelled) throw new Error("Generation stream was cancelled")
    const cursor = String(entry.next++)
    entry.events.push({ cursor, payload })
    for (const wake of entry.waiters) wake()
    return cursor
  }

  async *subscribe(
    generationId: string,
    after: string | null,
    signal: AbortSignal
  ) {
    let cursor = Number(after ?? "0")
    while (!signal.aborted) {
      const entry = this.entries.get(generationId)
      if (!entry) return
      const pending = entry.events.filter(
        (event) => Number(event.cursor) > cursor
      )
      if (pending.length) {
        for (const event of pending) {
          cursor = Number(event.cursor)
          yield event
        }
        continue
      }
      if (entry.closed) return
      await waitForChange(entry, signal)
    }
  }

  async heartbeat(producer: GenerationProducer) {
    const entry = this.entries.get(producer.generationId)
    if (!entry || entry.closed || entry.token !== producer.token)
      throw new Error("Generation stream is not active")
  }

  async inspect(generationId: string): Promise<GenerationStreamSnapshot> {
    const entry = this.entries.get(generationId)
    return {
      state: entry ? (entry.closed ? "closed" : "open") : "missing",
      cancelled: entry?.cancelled ?? false,
      meta: entry?.meta ?? null,
    }
  }

  async requestCancel(generationId: string) {
    const entry = this.entries.get(generationId)
    if (!entry) {
      this.pendingCancels.add(generationId)
      setTimeout(() => this.pendingCancels.delete(generationId), 5 * 60_000)
      return
    }
    entry.cancelled = true
    for (const wake of entry.waiters) wake()
  }

  async isCancelled(generationId: string) {
    return (
      this.entries.get(generationId)?.cancelled === true ||
      this.pendingCancels.has(generationId)
    )
  }

  async complete(producer: GenerationProducer, terminal: GenerationEvent["payload"]) {
    const entry = this.entries.get(producer.generationId)
    if (!entry || entry.closed || entry.token !== producer.token)
      throw new Error("Generation stream is not active")
    const cursor = String(entry.next++)
    entry.events.push({ cursor, payload: terminal })
    entry.closed = true
    for (const wake of entry.waiters) wake()
    setTimeout(() => this.entries.delete(producer.generationId), 5_000)
    return cursor
  }

  async close(producer: GenerationProducer) {
    const entry = this.entries.get(producer.generationId)
    if (!entry || entry.token !== producer.token || entry.closed) return
    entry.closed = true
    for (const wake of entry.waiters) wake()
    // Existing HTTP subscribers can drain their final buffered chunks. New
    // clients are rejected by the durable run lookup before reaching here.
    setTimeout(() => this.entries.delete(producer.generationId), 5_000)
  }

  async discard(generationId: string) {
    const entry = this.entries.get(generationId)
    if (!entry) return
    entry.closed = true
    for (const wake of entry.waiters) wake()
    this.entries.delete(generationId)
  }

  async replay(generationId: string) {
    return [...(this.entries.get(generationId)?.events ?? [])]
  }
}
