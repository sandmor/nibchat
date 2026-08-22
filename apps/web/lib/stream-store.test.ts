import { beforeEach, describe, expect, it } from "vitest"
import {
  chatStreamEntries,
  EMPTY_STREAM_BUFFER,
  useStreamStore,
} from "./stream-store"

describe("stream identity vs payload", () => {
  beforeEach(() => {
    useStreamStore.setState({ streams: {}, buffers: {}, controllers: {} })
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

  it("returns the shared empty buffer until a stream is started", () => {
    expect(useStreamStore.getState().buffers.missing).toBeUndefined()
    expect(EMPTY_STREAM_BUFFER.parts).toEqual([])
  })
})
