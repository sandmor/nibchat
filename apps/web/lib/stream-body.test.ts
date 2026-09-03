import { describe, expect, it } from "vitest"
import { streamBodySchema } from "@/lib/stream-body"

describe("streamBodySchema", () => {
  it("accepts retained MCP snapshot references", () => {
    expect(
      streamBodySchema.parse({
        intent: "continue",
        chatId: "chat-1",
        timeZone: "America/Bogota",
        content: "",
        editedFromNodeId: "user-1",
        attachments: [
          {
            kind: "mcp-resource",
            profileId: "profile-1",
            uri: "help://usage-guide",
            resolution: { kind: "snapshot", id: "part-1" },
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
        timeZone: "America/Bogota",
        content: "",
        attachments: [
          {
            kind: "mcp-resource",
            profileId: "profile-1",
            uri: "help://usage-guide",
            resolution: { kind: "live" },
            name: "Usage Guide",
            content: { kind: "text", text: "not accepted" },
          },
        ],
      }).success
    ).toBe(false)
  })

  it("accepts an optional browser time zone on every stream intent", () => {
    for (const input of [
      { intent: "continue", chatId: "chat-1", content: "Hi" },
      { intent: "regenerate", chatId: "chat-1", assistantNodeId: "a1" },
      {
        intent: "resume",
        chatId: "chat-1",
        assistantNodeId: "a1",
        toolResults: [{ toolCallId: "tool-1", output: {} }],
      },
    ] as const) {
      expect(
        streamBodySchema.parse({ ...input, timeZone: "America/Bogota" })
      ).toMatchObject({
        timeZone: "America/Bogota",
      })
    }
  })

  it("requires a supported browser time zone", () => {
    expect(
      streamBodySchema.safeParse({
        intent: "continue",
        chatId: "chat-1",
        content: "Hi",
      }).success
    ).toBe(false)
    expect(
      streamBodySchema.safeParse({
        intent: "continue",
        chatId: "chat-1",
        content: "Hi",
        timeZone: "Mars/Olympus",
      }).success
    ).toBe(false)
  })
})
