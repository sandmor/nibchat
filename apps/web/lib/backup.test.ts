import { describe, expect, it } from "vitest"
import { parseBackup } from "@/lib/backup"

describe("parseBackup", () => {
  it("requires chats and nodes arrays", () => {
    expect(() => parseBackup({ version: 1 })).toThrow()
  })

  it("parses provider profiles without api_key", () => {
    const backup = parseBackup({
      version: 1,
      chats: [
        {
          id: "c1",
          title: "t",
          selected_root_node_id: null,
          model_config_json: "{}",
          created_at: "t",
          updated_at: "t",
        },
      ],
      nodes: [],
      providerProfiles: [
        {
          id: "p1",
          name: "Local",
          kind: "openai-compatible",
          models_json: "[]",
          created_at: "t",
          updated_at: "t",
        },
      ],
    })
    expect(backup.providerProfiles).toHaveLength(1)
  })
})
