import { describe, expect, it } from "vitest"
import {
  isViewingChat,
  readStreamEvents,
  shouldSoftFollow,
  streamPlacement,
  type StreamRequestBody,
} from "./stream-helpers"
import type { NodeRow, ToolInvocationPart } from "@/lib/types"

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
      intent: "continue",
      parentNodeId: null,
      content: "hi",
    }
    expect(shouldSoftFollow(body, [], "c1", "/chat/c1")).toBe(true)
  })

  it("does not soft-follow after navigating to another chat", () => {
    const body: StreamRequestBody = {
      chatId: "c1",
      intent: "continue",
      parentNodeId: null,
      content: "hi",
    }
    expect(shouldSoftFollow(body, [], "c1", "/chat/other")).toBe(false)
  })

  it("soft-follows continue when tip is still the parent", () => {
    const body: StreamRequestBody = {
      chatId: "c1",
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
        controller.enqueue(encoder.encode('data: {"type":"text-delta","delta":"x"}\n\n'))
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
          tool: { type: "tool-invocation", toolCallId: "c1", toolName: "question", state: "input-streaming", input: {} },
        },
        {
          type: "tool-upsert",
          tool: { type: "tool-invocation", toolCallId: "c1", toolName: "question", state: "input-available", input: { questions: [] } },
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
