import { describe, expect, it } from "vitest"
import { followRedisGenerationLog } from "@/lib/generation-streams/adapters/redis-subscribe"
import type { GenerationEvent } from "@/lib/generation-streams/ports"

const text = (cursor: string, delta: string): GenerationEvent => ({
  cursor,
  payload: { type: "text-delta", id: cursor, delta },
})

describe("followRedisGenerationLog", () => {
  it("ranges only when seq advances, then idles until the lease dies", async () => {
    const pages = [[text("1", "a"), text("2", "b")], [text("3", "c")], []]
    let seq = 2
    let status: "open" | "closed" = "open"
    let lease: string | null = "tok"
    const ranged: Array<string | null> = []
    const controller = new AbortController()
    const received: string[] = []

    const follow = followRedisGenerationLog({
      after: null,
      signal: controller.signal,
      pollMs: 5,
      readMeta: async () => ({ token: "tok", status, seq }),
      readLease: async () => lease,
      readPage: async (after) => {
        ranged.push(after)
        return pages.shift() ?? []
      },
    })

    const run = (async () => {
      for await (const event of follow) {
        if (event.payload.type === "text-delta")
          received.push(event.payload.delta)
        if (received.length === 2) seq = 3
        if (received.length === 3) lease = null
      }
    })()

    await run
    expect(received).toEqual(["a", "b", "c"])
    expect(ranged).toEqual([null, "2", "3"])
  })

  it("stops after draining a closed stream without waiting on the lease", async () => {
    const controller = new AbortController()
    const events: string[] = []
    let leaseReads = 0
    for await (const event of followRedisGenerationLog({
      after: null,
      signal: controller.signal,
      pollMs: 5,
      readMeta: async () => ({ token: "tok", status: "closed", seq: 1 }),
      readLease: async () => {
        leaseReads += 1
        return "tok"
      },
      readPage: async () => (events.length ? [] : [text("1", "done")]),
    })) {
      if (event.payload.type === "text-delta") events.push(event.payload.delta)
    }
    expect(events).toEqual(["done"])
    expect(leaseReads).toBe(0)
  })
})
