import { afterEach, describe, expect, it, vi } from "vitest"
import {
  applyStoppingStreamPatches,
  followGenerationStream,
  isViewingChat,
  planStreamEnd,
  readStreamEvents,
  shouldFollowGeneration,
  shouldSoftFollow,
  streamPlacement,
  type StreamRequestBody,
} from "./stream-helpers"
import type { NodeRow, ToolInvocationPart } from "@/lib/types"
import type { StreamMeta } from "@/lib/stream-store"
import type { WorkspaceData } from "@/lib/workspace-cache"

function node(id: string): NodeRow {
  return {
    id,
    chat_id: "c1",
    parent_id: null,
    role: "user",
    status: "complete",
    selected_child_id: null,
    parts_json: "[]",
    search_text: "",
    metadata_json: "{}",
    excluded_from_context: false,
    created_at: "",
    updated_at: "",
  }
}

function sseBody(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const payload =
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") +
    "data: [DONE]\n\n"
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload))
      controller.close()
    },
  })
}

describe("isViewingChat", () => {
  it("matches /chat/[id] from the pathname", () => {
    expect(isViewingChat("abc", null, "/chat/abc")).toBe(true)
    expect(isViewingChat("other", "abc", "/chat/abc")).toBe(false)
  })

  it("on /chat/new requires selection to match the created id", () => {
    expect(isViewingChat("abc", "abc", "/chat/new")).toBe(true)
    expect(isViewingChat("abc", null, "/chat/new")).toBe(false)
  })

  it("falls back to selection when pathname is unavailable", () => {
    expect(isViewingChat("abc", "abc", null)).toBe(true)
    expect(isViewingChat("abc", null, null)).toBe(false)
  })

  it("fails closed on non-chat paths even if selection matches", () => {
    expect(isViewingChat("abc", "abc", "/settings")).toBe(false)
    expect(isViewingChat("abc", "abc", "/login")).toBe(false)
  })
})

describe("shouldSoftFollow", () => {
  it("soft-follows continue from empty tip when still on that chat", () => {
    const body: StreamRequestBody = {
      chatId: "c1",
      timeZone: "America/Bogota",
      intent: "continue",
      parentNodeId: null,
      content: "hi",
    }
    expect(shouldSoftFollow(body, [], "c1", "/chat/c1")).toBe(true)
  })

  it("does not soft-follow after navigating to another chat", () => {
    const body: StreamRequestBody = {
      chatId: "c1",
      timeZone: "America/Bogota",
      intent: "continue",
      parentNodeId: null,
      content: "hi",
    }
    expect(shouldSoftFollow(body, [], "c1", "/chat/other")).toBe(false)
  })

  it("soft-follows continue when tip is still the parent", () => {
    const body: StreamRequestBody = {
      chatId: "c1",
      timeZone: "America/Bogota",
      intent: "continue",
      parentNodeId: "u1",
      content: "hi",
    }
    expect(shouldSoftFollow(body, [node("u1")], "c1", "/chat/c1")).toBe(true)
    expect(shouldSoftFollow(body, [node("other")], "c1", "/chat/c1")).toBe(
      false
    )
  })

  it("soft-follows resume when the assistant is still on the path", () => {
    const body: StreamRequestBody = {
      chatId: "c1",
      timeZone: "America/Bogota",
      intent: "resume",
      assistantNodeId: "a1",
      toolResults: [{ toolCallId: "t1", output: [] }],
    }
    expect(
      shouldSoftFollow(body, [node("u1"), node("a1")], "c1", "/chat/c1")
    ).toBe(true)
  })
})

describe("streamPlacement", () => {
  it("places streams inline when the node is on the active path", () => {
    const path = [node("u1"), node("a1")]
    expect(
      streamPlacement({ nodeId: "a1", parentNodeId: "u1" }, path, path)
    ).toBe("inline")
  })

  it("hides streams that belong to another branch", () => {
    const u = node("u1")
    const a1 = { ...node("a1"), parent_id: "u1", selected_child_id: null }
    const a2 = { ...node("a2"), parent_id: "u1", selected_child_id: null }
    const path = [{ ...u, selected_child_id: "a1" }, a1]
    expect(
      streamPlacement({ nodeId: "a2", parentNodeId: "u1" }, path, [u, a1, a2])
    ).toBe("hidden")
  })

  it("shows under the tip when parent is tip and nothing else is selected", () => {
    const tip = { ...node("u1"), selected_child_id: null }
    expect(
      streamPlacement({ nodeId: "a1", parentNodeId: "u1" }, [tip], [tip])
    ).toBe("after-tip")
  })
})

describe("readStreamEvents", () => {
  it("forwards ordered generation events", async () => {
    const events: unknown[] = []
    await readStreamEvents(
      sseBody([
        { type: "text-delta", delta: "Hel" },
        { type: "reasoning-delta", delta: "think" },
        { type: "text-delta", delta: "lo" },
      ]),
      {
        onEvent: (event) => events.push(event),
      }
    )
    expect(events).toHaveLength(3)
  })

  it("reports SSE cursors alongside the stored UI event", async () => {
    const encoder = new TextEncoder()
    const cursors: string[] = []
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('id: 42\ndata: {"type":"text-delta","delta":"x"}\n\n')
        )
        controller.close()
      },
    })
    await readStreamEvents(body, {
      onEvent: () => {},
      onCursor: (cursor) => cursors.push(cursor),
    })
    expect(cursors).toEqual(["42"])
  })

  it("keeps an SSE cursor when id and data arrive in separate chunks", async () => {
    const encoder = new TextEncoder()
    const cursors: string[] = []
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("id: 42\n"))
        controller.enqueue(
          encoder.encode('data: {"type":"text-delta","delta":"x"}\n\n')
        )
        controller.close()
      },
    })
    await readStreamEvents(body, {
      onEvent: () => {},
      onCursor: (cursor) => cursors.push(cursor),
    })
    expect(cursors).toEqual(["42"])
  })

  it("forwards tool upsert events", async () => {
    const tools: ToolInvocationPart[] = []
    await readStreamEvents(
      sseBody([
        {
          type: "tool-upsert",
          tool: {
            type: "tool-invocation",
            toolCallId: "c1",
            toolName: "question",
            state: "input-streaming",
            input: {},
          },
        },
        {
          type: "tool-upsert",
          tool: {
            type: "tool-invocation",
            toolCallId: "c1",
            toolName: "question",
            state: "input-available",
            input: { questions: [] },
          },
        },
      ]),
      {
        onEvent: (event) => {
          if (event.type === "tool-upsert") tools.push(event.tool)
        },
      }
    )
    expect(tools).toHaveLength(2)
    expect(tools[0]?.state).toBe("input-streaming")
    expect(tools[1]).toMatchObject({
      state: "input-available",
      toolName: "question",
    })
  })
})

describe("planStreamEnd", () => {
  it("keeps the store when the local reader is aborted", () => {
    expect(
      planStreamEnd({
        reason: "aborted",
        stopping: false,
        nodeStatus: "streaming",
        hasParts: true,
      })
    ).toEqual({
      keepStore: true,
      write: "none",
      dropOverlay: false,
      invalidate: false,
    })
    expect(
      planStreamEnd({
        reason: "aborted",
        stopping: true,
        nodeStatus: "streaming",
        hasParts: true,
      }).keepStore
    ).toBe(true)
  })

  it("writes aborted when a stopping stream is gone and still streaming", () => {
    expect(
      planStreamEnd({
        reason: "gone",
        stopping: true,
        nodeStatus: "streaming",
        hasParts: true,
      })
    ).toEqual({
      keepStore: false,
      write: "aborted",
      dropOverlay: true,
      invalidate: true,
    })
  })

  it("does not write when gone and the node is already terminal", () => {
    expect(
      planStreamEnd({
        reason: "gone",
        stopping: false,
        nodeStatus: "complete",
        hasParts: true,
      })
    ).toEqual({
      keepStore: false,
      write: "none",
      dropOverlay: true,
      invalidate: true,
    })
  })

  it("hydrates parts when a live stream is gone and still streaming", () => {
    expect(
      planStreamEnd({
        reason: "gone",
        stopping: false,
        nodeStatus: "streaming",
        hasParts: true,
      })
    ).toEqual({
      keepStore: false,
      write: "hydrate",
      dropOverlay: true,
      invalidate: true,
    })
  })

  it("drops without hydrate when gone with an empty buffer", () => {
    expect(
      planStreamEnd({
        reason: "failed",
        stopping: false,
        nodeStatus: "streaming",
        hasParts: false,
      }).write
    ).toBe("none")
  })
})

describe("shouldFollowGeneration", () => {
  it("follows a stopping run that has no live reader", () => {
    expect(
      shouldFollowGeneration({
        streamId: "s1",
        node: { ...node("a1"), status: "streaming" },
        controllers: {},
        stream: {
          nodeId: "a1",
          chatId: "c1",
          parentNodeId: "u1",
          startedAt: 1,
          stopping: true,
        },
      })
    ).toBe(true)
  })

  it("does not follow while a reader is attached", () => {
    const controller = new AbortController()
    expect(
      shouldFollowGeneration({
        streamId: "s1",
        node: { ...node("a1"), status: "streaming" },
        controllers: { s1: controller },
        stream: undefined,
      })
    ).toBe(false)
  })

  it("does not follow a node that is already complete", () => {
    expect(
      shouldFollowGeneration({
        streamId: "s1",
        node: { ...node("a1"), status: "complete" },
        controllers: {},
        stream: undefined,
      })
    ).toBe(false)
  })
})

describe("applyStoppingStreamPatches", () => {
  it("paints aborted parts and keeps activeGenerations", () => {
    const data: WorkspaceData = {
      chats: [],
      chat: null,
      nodes: [{ ...node("a1"), role: "assistant", status: "streaming" }],
      activeGenerations: [
        {
          generationId: "g1",
          nodeId: "a1",
          chatId: "c1",
          parentNodeId: "u1",
          startedAt: "",
        },
      ],
    }
    const streams: Record<string, StreamMeta> = {
      g1: {
        nodeId: "a1",
        chatId: "c1",
        parentNodeId: "u1",
        startedAt: 1,
        stopping: true,
      },
    }
    const next = applyStoppingStreamPatches(data, streams, {
      g1: { parts: [{ type: "text", text: "Hello" }] },
    })
    expect(next?.nodes[0]?.status).toBe("stopped")
    expect(JSON.parse(next?.nodes[0]?.parts_json ?? "[]")).toEqual([
      { type: "text", text: "Hello" },
    ])
    expect(next?.activeGenerations).toHaveLength(1)
  })
})

describe("followGenerationStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("reattaches after a clean SSE end and returns gone on 410", async () => {
    const encoder = new TextEncoder()
    const events: unknown[] = []
    let calls = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1
        if (calls === 1) {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    'id: 1\ndata: {"type":"text-delta","delta":"Hi"}\n\n'
                  )
                )
                controller.close()
              },
            }),
            { status: 200 }
          )
        }
        return new Response(null, { status: 410 })
      })
    )
    const result = await followGenerationStream({
      streamId: "g1",
      signal: new AbortController().signal,
      cursor: null,
      onEvent: (event) => events.push(event),
      onCursor: () => {},
    })
    expect(result).toBe("gone")
    expect(calls).toBe(2)
    expect(events).toEqual([{ type: "text-delta", delta: "Hi" }])
  })

  it("does not treat the first body close as complete", async () => {
    const encoder = new TextEncoder()
    const events: unknown[] = []
    let calls = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1
        if (calls === 1) {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    'id: 1\ndata: {"type":"text-delta","delta":"Hel"}\n\n'
                  )
                )
                controller.close()
              },
            }),
            { status: 200 }
          )
        }
        if (calls === 2) {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    'id: 2\ndata: {"type":"text-delta","delta":"lo"}\n\n'
                  )
                )
                controller.close()
              },
            }),
            { status: 200 }
          )
        }
        return new Response(null, { status: 404 })
      })
    )
    const result = await followGenerationStream({
      streamId: "g1",
      signal: new AbortController().signal,
      cursor: null,
      onEvent: (event) => events.push(event),
      onCursor: () => {},
    })
    expect(result).toBe("gone")
    expect(calls).toBe(3)
    expect(events).toEqual([
      { type: "text-delta", delta: "Hel" },
      { type: "text-delta", delta: "lo" },
    ])
  })

  it("returns aborted when cancelled during a failed attach", async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
        queueMicrotask(() => controller.abort())
        return new Response(null, { status: 500 })
      })
    )
    const result = await followGenerationStream({
      streamId: "g1",
      signal: controller.signal,
      cursor: null,
      onEvent: () => {},
      onCursor: () => {},
    })
    expect(result).toBe("aborted")
  })
})
