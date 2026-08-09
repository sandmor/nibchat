import { describe, expect, it } from "vitest"
import { patchChatTitle, type WorkspaceData } from "@/lib/workspace-cache"

function sample(chatId: string, title: string): WorkspaceData {
  return {
    chats: [
      {
        id: chatId,
        user_id: "u",
        title,
        model_config_json: "{}",
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
      prompt_stack_id: null,
      selected_root_node_id: null,
      created_at: "",
      updated_at: "",
    },
    nodes: [],
  }
}

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
          prompt_stack_id: null,
          selected_root_node_id: null,
          created_at: "",
          updated_at: "",
        },
      ],
      chat: null,
      nodes: [],
    }
    const next = patchChatTitle(data, "c2", "B2")
    expect(next?.chats.find((c) => c.id === "c1")?.title).toBe("A")
    expect(next?.chats.find((c) => c.id === "c2")?.title).toBe("B2")
  })
})
