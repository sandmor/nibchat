import { describe, expect, it } from "vitest"
import { streamBodySchema } from "@/lib/stream-body"

describe("streamBodySchema", () => {
  it("accepts MCP resource references without client snapshots", () => {
    expect(
      streamBodySchema.parse({
        intent: "continue",
        chatId: "chat-1",
        content: "",
        attachments: [
          {
            kind: "mcp-resource",
            profileId: "profile-1",
            uri: "help://usage-guide",
          },
        ],
      })
    ).toMatchObject({ intent: "continue" })
  })

  it("rejects client-supplied attachment snapshots", () => {
    expect(
      streamBodySchema.safeParse({
        intent: "continue",
        chatId: "chat-1",
        content: "",
        attachments: [
          {
            kind: "mcp-resource",
            profileId: "profile-1",
            uri: "help://usage-guide",
            name: "Usage Guide",
            content: { kind: "text", text: "not accepted" },
          },
        ],
      }).success
    ).toBe(false)
  })
})
