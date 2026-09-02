import { describe, expect, it } from "vitest"
import { MemoryGenerationStreamPort } from "@/lib/generation-streams/adapters/memory"

const meta = {
  generationId: "g1",
  nodeId: "n1",
  chatId: "c1",
  parentNodeId: null,
}

describe("MemoryGenerationStreamPort", () => {
  it("replays ordered events independently to multiple subscribers", async () => {
    const store = new MemoryGenerationStreamPort()
    const producer = await store.open(meta)
    await store.append(producer, { type: "text-delta", id: "t1", delta: "one" })
    await store.append(producer, { type: "text-delta", id: "t1", delta: "two" })
    const controller = new AbortController()
    const reader = store
      .subscribe("g1", null, controller.signal)
      [Symbol.asyncIterator]()
    expect((await reader.next()).value).toMatchObject({
      cursor: "1",
      payload: { type: "text-delta", id: "t1", delta: "one" },
    })
    expect((await reader.next()).value).toMatchObject({
      cursor: "2",
      payload: { type: "text-delta", id: "t1", delta: "two" },
    })
    const second = store
      .subscribe("g1", "1", controller.signal)
      [Symbol.asyncIterator]()
    expect((await second.next()).value).toMatchObject({ cursor: "2" })
    controller.abort()
  })

  it("records cancellation without dropping buffered events", async () => {
    const store = new MemoryGenerationStreamPort()
    const producer = await store.open(meta)
    await store.append(producer, { type: "text-delta", id: "t1", delta: "one" })
    await store.requestCancel("g1")
    expect(await store.isCancelled("g1")).toBe(true)
    const controller = new AbortController()
    const reader = store
      .subscribe("g1", null, controller.signal)
      [Symbol.asyncIterator]()
    expect((await reader.next()).value).toMatchObject({
      payload: { type: "text-delta", id: "t1", delta: "one" },
    })
    controller.abort()
  })

  it("remembers cancellation requested before the stream is opened", async () => {
    const store = new MemoryGenerationStreamPort()
    await store.requestCancel("g1")
    expect(await store.isCancelled("g1")).toBe(true)
    const producer = await store.open(meta)
    expect(await store.isCancelled("g1")).toBe(true)
    await expect(
      store.append(producer, { type: "text-delta", id: "t1", delta: "one" })
    ).rejects.toThrow("cancelled")
  })

  it("ends a subscriber after it drains a closed stream", async () => {
    const store = new MemoryGenerationStreamPort()
    const producer = await store.open(meta)
    await store.append(producer, {
      type: "text-delta",
      id: "t1",
      delta: "done",
    })
    await store.close(producer)
    const reader = store
      .subscribe("g1", null, new AbortController().signal)
      [Symbol.asyncIterator]()
    expect((await reader.next()).value).toMatchObject({ cursor: "1" })
    expect(await reader.next()).toMatchObject({ done: true })
  })

  it("publishes a terminal event even after cancellation", async () => {
    const store = new MemoryGenerationStreamPort()
    const producer = await store.open(meta)
    await store.requestCancel("g1")
    await store.complete(producer, {
      type: "terminal",
      result: "stopped",
      node: null,
    })
    const replay = await store.replay("g1")
    expect(replay.at(-1)?.payload).toMatchObject({
      type: "terminal",
      result: "stopped",
    })
    expect((await store.inspect("g1")).state).toBe("closed")
  })

  it("lets a late subscriber drain the terminal event after complete", async () => {
    const store = new MemoryGenerationStreamPort()
    const producer = await store.open(meta)
    await store.append(producer, {
      type: "text-delta",
      id: "t1",
      delta: "done",
    })
    await store.complete(producer, {
      type: "terminal",
      result: "complete",
      node: null,
    })
    const snapshot = await store.inspect("g1")
    expect(snapshot.state).toBe("closed")
    expect(snapshot.meta).toEqual(meta)

    const events: unknown[] = []
    for await (const event of store.subscribe(
      "g1",
      null,
      new AbortController().signal
    )) {
      events.push(event.payload)
    }
    expect(events.at(-1)).toMatchObject({
      type: "terminal",
      result: "complete",
    })
  })
})
