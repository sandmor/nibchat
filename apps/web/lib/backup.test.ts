import { describe, expect, it } from "vitest"
import { parseBackup } from "@/lib/backup"
import { defaultPromptStack, promptStackToJson } from "@/lib/prompt-stack"

describe("parseBackup", () => {
  it("rejects unknown backup versions", () => {
    expect(() => parseBackup({ version: 0, chats: [], nodes: [] })).toThrow()
  })

  it("requires chats and nodes arrays", () => {
    expect(() => parseBackup({ version: 1 })).toThrow()
  })

  it("parses the current backup format with stacks and provider profiles", () => {
    const backup = parseBackup({
      version: 1,
      chats: [
        {
          id: "c1",
          user_id: "u1",
          title: "t",
          selected_root_node_id: null,
          model_config_json: "{}",
          created_at: "t",
          updated_at: "t",
        },
      ],
      nodes: [],
      promptStacks: [
        {
          id: "default",
          user_id: "u1",
          name: "Default",
          stack_json: promptStackToJson(defaultPromptStack()),
          created_at: "t",
          updated_at: "t",
        },
      ],
      providerProfiles: [
        {
          id: "p1",
          user_id: "u1",
          name: "Local",
          kind: "openai-compatible",
          models_json: '{"version":1,"preferences":[]}',
          created_at: "t",
          updated_at: "t",
        },
      ],
    })
    expect(backup.version).toBe(1)
    expect(backup.providerProfiles).toHaveLength(1)
    expect(backup.promptStacks).toHaveLength(1)
  })

  it("parses a null chat title and optional title model", () => {
    const backup = parseBackup({
      version: 1,
      chats: [
        {
          id: "c1",
          user_id: "u1",
          title: null,
          selected_root_node_id: null,
          model_config_json: "{}",
          created_at: "t",
          updated_at: "t",
        },
      ],
      nodes: [],
      instance: {
        titleModelConfig: { providerId: "p1", model: "fast" },
      },
    })
    expect(backup.chats[0]?.title).toBeNull()
    expect(backup.instance?.titleModelConfig).toEqual({
      providerId: "p1",
      model: "fast",
    })
  })

  it("requires a context-exclusion flag for every message node", () => {
    const node = {
      id: "n1",
      chat_id: "c1",
      parent_id: null,
      selected_child_id: null,
      role: "user",
      parts_json: "[]",
      search_text: "",
      metadata_json: "{}",
      status: "complete",
      created_at: "t",
      updated_at: "t",
    }
    expect(() =>
      parseBackup({ version: 1, chats: [], nodes: [node] })
    ).toThrow()
    expect(
      parseBackup({
        version: 1,
        chats: [],
        nodes: [{ ...node, excluded_from_context: false }],
      }).nodes[0]?.excluded_from_context
    ).toBe(false)
  })
})
