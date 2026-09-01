import { describe, expect, it } from "vitest"
import {
  hydrateStreamingNodeParts,
  patchChatTitle,
  patchNodeFromStreamParts,
  patchTerminalGeneration,
  type WorkspaceData,
} from "@/lib/workspace-cache"

function sample(chatId: string, title: string): WorkspaceData {
  return {
    chats: [
      {
        id: chatId,
        user_id: "u",
        title,
        model_config_json: "{}",
        view_state_json: '{"mode":"linear","camera":null}',
        prompt_stack_id: null,
        selected_root_node_id: null,
        created_at: "",
        updated_at: "",
      },
    ],
    chat: {
      id: chatId,
      user_id: "u",
      title,
      model_config_json: "{}",
      view_state_json: '{"mode":"linear","camera":null}',
      prompt_stack_id: null,
      selected_root_node_id: null,
      created_at: "",
      updated_at: "",
    },
    nodes: [],
    activeGenerations: [],
  }
}

function streamingAssistant(
  data: WorkspaceData,
  extras?: { parts?: Array<{ type: "text"; text: string }> }
): WorkspaceData {
  data.nodes = [
    {
      id: "a1",
      chat_id: "c1",
      parent_id: "u1",
      role: "assistant",
      status: "streaming",
      selected_child_id: null,
      parts_json: JSON.stringify(extras?.parts ?? []),
      search_text: "",
      metadata_json: "{}",
      excluded_from_context: false,
      created_at: "",
      updated_at: "",
    },
  ]
  data.activeGenerations = [
    {
      generationId: "g1",
      nodeId: "a1",
      chatId: "c1",
      parentNodeId: "u1",
      startedAt: "",
    },
  ]
  return data
}

describe("patchNodeFromStreamParts", () => {
  it("writes aborted partials as stopped and clears the generation", () => {
    const next = patchNodeFromStreamParts(
      streamingAssistant(sample("c1", "Chat")),
      "a1",
      [{ type: "text", text: "Hello" }],
      "aborted"
    )
    expect(next?.nodes[0]?.status).toBe("stopped")
    expect(JSON.parse(next?.nodes[0]?.parts_json ?? "[]")).toEqual([
      { type: "text", text: "Hello" },
    ])
    expect(next?.activeGenerations).toEqual([])
  })

  it("writes a finished buffer as complete", () => {
    const next = patchNodeFromStreamParts(
      streamingAssistant(sample("c1", "Chat")),
      "a1",
      [{ type: "text", text: "Done" }],
      "complete"
    )
    expect(next?.nodes[0]?.status).toBe("complete")
    expect(JSON.parse(next?.nodes[0]?.parts_json ?? "[]")).toEqual([
      { type: "text", text: "Done" },
    ])
    expect(next?.activeGenerations).toEqual([])
  })

  it("keeps pending client tools as awaiting_input when aborted", () => {
    const next = patchNodeFromStreamParts(
      streamingAssistant(sample("c1", "Chat")),
      "a1",
      [
        {
          type: "tool-invocation",
          toolCallId: "c1",
          toolName: "question",
          state: "input-available",
          input: { questions: [] },
        },
      ],
      "aborted"
    )
    expect(next?.nodes[0]?.status).toBe("awaiting_input")
  })

  it("does not clobber a node that is already complete", () => {
    const data = streamingAssistant(sample("c1", "Chat"))
    data.nodes[0] = {
      ...data.nodes[0]!,
      status: "complete",
      parts_json: JSON.stringify([{ type: "text", text: "Server" }]),
    }
    const next = patchNodeFromStreamParts(
      data,
      "a1",
      [{ type: "text", text: "Stale" }],
      "complete"
    )
    expect(next).toBe(data)
    expect(JSON.parse(next?.nodes[0]?.parts_json ?? "[]")).toEqual([
      { type: "text", text: "Server" },
    ])
  })

  it("does not clobber a node that is already stopped", () => {
    const data = streamingAssistant(sample("c1", "Chat"))
    data.nodes[0] = { ...data.nodes[0]!, status: "stopped" }
    const next = patchNodeFromStreamParts(
      data,
      "a1",
      [{ type: "text", text: "Stale" }],
      "aborted"
    )
    expect(next).toBe(data)
  })
})

describe("hydrateStreamingNodeParts", () => {
  it("copies parts without changing status or generations", () => {
    const next = hydrateStreamingNodeParts(
      streamingAssistant(sample("c1", "Chat")),
      "a1",
      [{ type: "text", text: "Hello" }]
    )
    expect(next?.nodes[0]?.status).toBe("streaming")
    expect(JSON.parse(next?.nodes[0]?.parts_json ?? "[]")).toEqual([
      { type: "text", text: "Hello" },
    ])
    expect(next?.activeGenerations).toHaveLength(1)
  })

  it("is a no-op when the node is already complete", () => {
    const data = streamingAssistant(sample("c1", "Chat"))
    data.nodes[0] = {
      ...data.nodes[0]!,
      status: "complete",
      parts_json: JSON.stringify([{ type: "text", text: "Done" }]),
    }
    const next = hydrateStreamingNodeParts(data, "a1", [
      { type: "text", text: "Stale" },
    ])
    expect(next).toBe(data)
  })
})

describe("patchTerminalGeneration", () => {
  it("replaces the streaming node and drops the generation", () => {
    const done = {
      ...streamingAssistant(sample("c1", "Chat")).nodes[0]!,
      status: "complete" as const,
      parts_json: JSON.stringify([{ type: "text", text: "Done" }]),
    }
    const next = patchTerminalGeneration(
      streamingAssistant(sample("c1", "Chat")),
      {
        generationId: "g1",
        node: done,
        chatId: "c1",
        nodeId: "a1",
      }
    )
    expect(next?.nodes).toEqual([done])
    expect(next?.activeGenerations).toEqual([])
  })

  it("inserts a missing node in created-at order", () => {
    const data = sample("c1", "Chat")
    data.nodes = [
      {
        id: "u1",
        chat_id: "c1",
        parent_id: null,
        role: "user",
        status: "complete",
        selected_child_id: "a1",
        parts_json: "[]",
        search_text: "",
        metadata_json: "{}",
        excluded_from_context: false,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ]
    data.activeGenerations = [
      {
        generationId: "g1",
        nodeId: "a1",
        chatId: "c1",
        parentNodeId: "u1",
        startedAt: "",
      },
    ]
    const assistant = {
      id: "a1",
      chat_id: "c1",
      parent_id: "u1",
      role: "assistant" as const,
      status: "complete" as const,
      selected_child_id: null,
      parts_json: JSON.stringify([{ type: "text", text: "Hi" }]),
      search_text: "Hi",
      metadata_json: "{}",
      excluded_from_context: false,
      created_at: "2026-01-01T00:00:01.000Z",
      updated_at: "2026-01-01T00:00:01.000Z",
    }
    const next = patchTerminalGeneration(data, {
      generationId: "g1",
      node: assistant,
      chatId: "c1",
      nodeId: "a1",
    })
    expect(next?.nodes.map((row) => row.id)).toEqual(["u1", "a1"])
    expect(next?.nodes[1]).toEqual(assistant)
    expect(next?.activeGenerations).toEqual([])
  })

  it("removes the node when the terminal snapshot is empty", () => {
    const next = patchTerminalGeneration(
      streamingAssistant(sample("c1", "Chat")),
      {
        generationId: "g1",
        node: null,
        chatId: "c1",
        nodeId: "a1",
      }
    )
    expect(next?.nodes).toEqual([])
    expect(next?.activeGenerations).toEqual([])
  })

  it("leaves a different chat's cache alone", () => {
    const data = streamingAssistant(sample("c1", "Chat"))
    const next = patchTerminalGeneration(data, {
      generationId: "g1",
      node: null,
      chatId: "other",
      nodeId: "a1",
    })
    expect(next).toBe(data)
  })
})

describe("patchChatTitle", () => {
  it("patches list and active chat title", () => {
    const next = patchChatTitle(sample("c1", "Old"), "c1", "New")
    expect(next?.chat?.title).toBe("New")
    expect(next?.chats[0]?.title).toBe("New")
  })

  it("leaves other chats alone", () => {
    const data: WorkspaceData = {
      chats: [
        {
          id: "c1",
          user_id: "u",
          title: "A",
          model_config_json: "{}",
          view_state_json: '{"mode":"linear","camera":null}',
          prompt_stack_id: null,
          selected_root_node_id: null,
          created_at: "",
          updated_at: "",
        },
        {
          id: "c2",
          user_id: "u",
          title: "B",
          model_config_json: "{}",
          view_state_json: '{"mode":"linear","camera":null}',
          prompt_stack_id: null,
          selected_root_node_id: null,
          created_at: "",
          updated_at: "",
        },
      ],
      chat: null,
      nodes: [],
      activeGenerations: [],
    }
    const next = patchChatTitle(data, "c2", "B2")
    expect(next?.chats.find((c) => c.id === "c1")?.title).toBe("A")
    expect(next?.chats.find((c) => c.id === "c2")?.title).toBe("B2")
  })
})
