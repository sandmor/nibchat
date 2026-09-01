import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  abortChatStreamReaders,
  chatStreamEntries,
  EMPTY_STREAM_BUFFER,
  hasLiveStreamReader,
  useStreamStore,
} from "./stream-store"

describe("stream identity vs payload", () => {
  beforeEach(() => {
    useStreamStore.setState({
      streams: {},
      buffers: {},
      controllers: {},
      cursors: {},
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("keeps stream metas stable when only tokens change", () => {
    const { start, applyEvent } = useStreamStore.getState()
    start("s1", { nodeId: "n1", chatId: "c1", parentNodeId: null })
    const metasBefore = useStreamStore.getState().streams
    const buffersBefore = useStreamStore.getState().buffers
    applyEvent("s1", { type: "text-delta", delta: "Hel" })
    applyEvent("s1", { type: "text-delta", delta: "lo" })
    applyEvent("s1", { type: "reasoning-delta", delta: "think" })
    expect(useStreamStore.getState().streams).toBe(metasBefore)
    expect(useStreamStore.getState().buffers).not.toBe(buffersBefore)
    expect(useStreamStore.getState().buffers.s1?.parts).toEqual([
      { type: "text", text: "Hello" },
      { type: "reasoning", text: "think" },
    ])
  })

  it("replaces stream metas when a generation starts or finishes", () => {
    const { start, finish } = useStreamStore.getState()
    expect(useStreamStore.getState().streams).toEqual({})
    start("s1", { nodeId: "n1", chatId: "c1", parentNodeId: null })
    const open = useStreamStore.getState().streams
    expect(Object.keys(open)).toEqual(["s1"])
    finish("s1")
    expect(useStreamStore.getState().streams).not.toBe(open)
    expect(useStreamStore.getState().streams).toEqual({})
    expect(useStreamStore.getState().buffers).toEqual({})
  })

  it("settles a terminal reader until workspace confirms collection", () => {
    const { start, applyEvent, attachController, settle, finish } =
      useStreamStore.getState()
    start("s1", { nodeId: "n1", chatId: "c1", parentNodeId: null })
    applyEvent("s1", { type: "text-delta", delta: "Hello" })
    attachController("s1", new AbortController())

    settle("s1")
    expect(useStreamStore.getState().streams.s1?.settled).toBe(true)
    expect(useStreamStore.getState().controllers.s1).toBeUndefined()
    expect(useStreamStore.getState().buffers.s1?.parts).toEqual([
      { type: "text", text: "Hello" },
    ])
    expect(
      chatStreamEntries(useStreamStore.getState().streams, ["c1"]).map(
        ([streamId]) => streamId
      )
    ).toEqual(["s1"])

    finish("s1")
    expect(useStreamStore.getState().streams.s1).toBeUndefined()
    expect(useStreamStore.getState().buffers.s1).toBeUndefined()
  })

  it("does not reset an existing buffer when start is called again", () => {
    const { start, applyEvent } = useStreamStore.getState()
    start("s1", { nodeId: "n1", chatId: "c1", parentNodeId: null })
    applyEvent("s1", { type: "text-delta", delta: "Hello" })
    const buffersBefore = useStreamStore.getState().buffers
    start("s1", { nodeId: "n1", chatId: "c1", parentNodeId: "p1" })
    expect(useStreamStore.getState().buffers).toBe(buffersBefore)
    expect(useStreamStore.getState().buffers.s1?.parts).toEqual([
      { type: "text", text: "Hello" },
    ])
    expect(useStreamStore.getState().streams.s1?.parentNodeId).toBe("p1")
  })

  it("keeps the token buffer when a reader detaches", () => {
    const { start, applyEvent, attachController, detachController } =
      useStreamStore.getState()
    start("s1", { nodeId: "n1", chatId: "c1", parentNodeId: null })
    applyEvent("s1", { type: "text-delta", delta: "Hello" })
    const controller = new AbortController()
    attachController("s1", controller)
    detachController("s1")
    expect(useStreamStore.getState().controllers.s1).toBeUndefined()
    expect(useStreamStore.getState().buffers.s1?.parts).toEqual([
      { type: "text", text: "Hello" },
    ])
    expect(useStreamStore.getState().streams.s1).toBeDefined()
  })

  it("marks a stream stopping without clearing parts", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    )
    const { start, applyEvent, attachController, stop } =
      useStreamStore.getState()
    start("s1", { nodeId: "n1", chatId: "c1", parentNodeId: null })
    applyEvent("s1", { type: "text-delta", delta: "Hello" })
    const controller = new AbortController()
    attachController("s1", controller)
    stop("s1")
    expect(useStreamStore.getState().streams.s1?.stopping).toBe(true)
    expect(controller.signal.aborted).toBe(false)
    expect(useStreamStore.getState().controllers.s1).toBe(controller)
    expect(useStreamStore.getState().buffers.s1?.parts).toEqual([
      { type: "text", text: "Hello" },
    ])
  })

  it("lists only the requested chats and ignores token payload", () => {
    const { start, applyEvent } = useStreamStore.getState()
    start("a", { nodeId: "n1", chatId: "c1", parentNodeId: null })
    start("b", { nodeId: "n2", chatId: "c2", parentNodeId: null })
    applyEvent("a", { type: "text-delta", delta: "nope" })
    expect(
      chatStreamEntries(useStreamStore.getState().streams, ["c1", null]).map(
        ([id]) => id
      )
    ).toEqual(["a"])
  })

  it("omits stopping streams from overlay placement", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    )
    const { start, stop } = useStreamStore.getState()
    start("a", { nodeId: "n1", chatId: "c1", parentNodeId: null })
    stop("a")
    expect(
      chatStreamEntries(useStreamStore.getState().streams, ["c1"]).map(
        ([id]) => id
      )
    ).toEqual([])
  })

  it("returns the shared empty buffer until a stream is started", () => {
    expect(useStreamStore.getState().buffers.missing).toBeUndefined()
    expect(EMPTY_STREAM_BUFFER.parts).toEqual([])
  })

  it("reports a live reader only while the controller is attached and open", () => {
    const { start, attachController } = useStreamStore.getState()
    start("s1", { nodeId: "n1", chatId: "c1", parentNodeId: null })
    expect(
      hasLiveStreamReader(useStreamStore.getState().controllers, "s1")
    ).toBe(false)
    const controller = new AbortController()
    attachController("s1", controller)
    expect(
      hasLiveStreamReader(useStreamStore.getState().controllers, "s1")
    ).toBe(true)
    controller.abort()
    expect(
      hasLiveStreamReader(useStreamStore.getState().controllers, "s1")
    ).toBe(false)
  })

  it("aborts readers for one chat and keeps the token buffer", () => {
    const { start, applyEvent, attachController } = useStreamStore.getState()
    start("a", { nodeId: "n1", chatId: "c1", parentNodeId: null })
    start("b", { nodeId: "n2", chatId: "c2", parentNodeId: null })
    applyEvent("a", { type: "text-delta", delta: "Hello" })
    const keep = new AbortController()
    const drop = new AbortController()
    attachController("a", drop)
    attachController("b", keep)
    abortChatStreamReaders(["c1"])
    expect(drop.signal.aborted).toBe(true)
    expect(keep.signal.aborted).toBe(false)
    expect(useStreamStore.getState().controllers.a).toBeUndefined()
    expect(useStreamStore.getState().controllers.b).toBe(keep)
    expect(useStreamStore.getState().buffers.a?.parts).toEqual([
      { type: "text", text: "Hello" },
    ])
    expect(useStreamStore.getState().streams.a).toBeDefined()
  })

  it("aborts a stopping reader when leaving the chat", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    )
    const { start, applyEvent, attachController, stop } =
      useStreamStore.getState()
    start("a", { nodeId: "n1", chatId: "c1", parentNodeId: null })
    applyEvent("a", { type: "text-delta", delta: "Hello" })
    const controller = new AbortController()
    attachController("a", controller)
    stop("a")
    abortChatStreamReaders(["c1"])
    expect(controller.signal.aborted).toBe(true)
    expect(useStreamStore.getState().controllers.a).toBeUndefined()
    expect(useStreamStore.getState().streams.a?.stopping).toBe(true)
    expect(useStreamStore.getState().buffers.a?.parts).toEqual([
      { type: "text", text: "Hello" },
    ])
  })

  it("does not detach a replacement reader for the same stream", () => {
    const { start, attachController, detachController } =
      useStreamStore.getState()
    start("s1", { nodeId: "n1", chatId: "c1", parentNodeId: null })
    const first = new AbortController()
    const second = new AbortController()
    attachController("s1", first)
    attachController("s1", second)
    detachController("s1", first)
    expect(useStreamStore.getState().controllers.s1).toBe(second)
  })
})
