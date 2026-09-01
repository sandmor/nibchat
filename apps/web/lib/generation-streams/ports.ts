import "server-only"
import type { GenerationPayload } from "@/lib/generation-streams/events"
import type { GenerationStoreState } from "@/lib/generation-streams/policy"

/** A UI chunk is intentionally opaque to the transport store. */
export type GenerationEvent = {
  cursor: string
  payload: GenerationPayload
}

export type GenerationStreamMeta = {
  generationId: string
  nodeId: string
  chatId: string
  parentNodeId: string | null
}

export type GenerationStreamSnapshot = {
  state: GenerationStoreState
  cancelled: boolean
  /** Retained during the short post-close drain window for authenticated replay. */
  meta: GenerationStreamMeta | null
}

export type GenerationProducer = {
  generationId: string
  token: string
}

/**
 * Durable-event boundary for a single generation. Consumers own their own
 * cursor: this is broadcast/replay semantics, never work-queue semantics.
 */
export interface GenerationStreamPort {
  open(meta: GenerationStreamMeta): Promise<GenerationProducer>
  append(producer: GenerationProducer, payload: GenerationPayload): Promise<string>
  subscribe(
    generationId: string,
    after: string | null,
    signal: AbortSignal
  ): AsyncIterable<GenerationEvent>
  /**
   * Renew a producer fence. Lease-backed adapters must also renew from
   * `open()` until `close()`/`discard()` so callers cannot forget.
   */
  heartbeat(producer: GenerationProducer): Promise<void>
  inspect(generationId: string): Promise<GenerationStreamSnapshot>
  requestCancel(generationId: string): Promise<void>
  isCancelled(generationId: string): Promise<boolean>
  /** Atomically append the durable terminal event and close the producer. */
  complete(producer: GenerationProducer, terminal: GenerationPayload): Promise<string>
  close(producer: GenerationProducer): Promise<void>
  replay(generationId: string): Promise<GenerationEvent[]>
  /** Best-effort cleanup used when terminal persistence cannot complete. */
  discard(generationId: string): Promise<void>
}

export interface GenerationLifetimePort {
  retain(task: Promise<unknown>): void
}

/** Owns provider execution independently of HTTP subscribers. */
export interface GenerationExecutorPort {
  execute(input: {
    generationId: string
    nodeId: string
    run: () => Promise<void>
  }): void
}
