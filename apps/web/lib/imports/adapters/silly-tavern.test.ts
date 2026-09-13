import { describe, expect, it } from "vitest"
import type { ImportArchivePort } from "@/lib/imports/model"
import { sillyTavernFormat } from "./silly-tavern"

function files(entries: Record<string, Uint8Array>): ImportArchivePort {
  const stored = new Map(Object.entries(entries))
  return {
    names: () => [...stored.keys()],
    size: (name) => stored.get(name)?.length ?? 0,
    stream: async (name) =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(stored.get(name)!)
          controller.close()
        },
      }),
  }
}

async function collect(archive: ImportArchivePort) {
  const conversations = []
  for await (const item of sillyTavernFormat.conversations(archive))
    conversations.push(item)
  const entities = []
  for await (const item of sillyTavernFormat.entities!(archive))
    entities.push(item)
  return { conversations, entities }
}

function pngCard(card: unknown) {
  const encoder = new TextEncoder()
  const payload = btoa(JSON.stringify(card))
  const text = encoder.encode(`chara\0${payload}`)
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(data.length + 12)
    new DataView(out.buffer).setUint32(0, data.length)
    out.set(encoder.encode(type), 4)
    out.set(data, 8)
    return out
  }
  return new Uint8Array([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...chunk("tEXt", text),
    ...chunk("IEND", new Uint8Array()),
  ])
}

describe("SillyTavern import adapter", () => {
  it("parses character cards, swipes, and chat variables", async () => {
    const encoder = new TextEncoder()
    const { conversations } = await collect(
      files({
        "characters/Ada.png": pngCard({
          spec: "chara_card_v2",
          data: {
            name: "Ada",
            system_prompt: "Be Ada",
            first_mes: "Welcome",
            character_book: { entries: [{ content: "Do not import" }] },
          },
        }),
        "chats/Ada/Ada chat.jsonl": encoder.encode(
          [
            {
              chat_metadata: {
                variables: { location: "library", bad: 12 },
              },
            },
            { name: "System", is_system: true, mes: "Hidden notice" },
            {
              name: "System",
              is_system: true,
              extra: { type: "narrator" },
              mes: "The door opens.",
            },
            { name: "User", is_user: true, mes: "Hello" },
            {
              name: "Ada",
              mes: "Second",
              swipes: ["First", "Second"],
              swipe_id: 1,
              swipe_info: [
                { extra: { reasoning: "old" } },
                { extra: { reasoning: "chosen", model: "m" } },
              ],
            },
          ]
            .map((line) => JSON.stringify(line))
            .join("\n")
        ),
      })
    )
    const chat = conversations[0]!
    expect(chat.entity).toMatchObject({
      aliases: ["character:Ada"],
      variables: { character_name: "Ada", system_prompt: "Be Ada" },
      metadata: { firstMessage: "Welcome" },
    })
    expect(JSON.stringify(chat.entity)).not.toContain("Do not import")
    expect(chat.variables).toEqual({ location: "library" })
    expect(chat.nodes[0]).toMatchObject({ role: "assistant", excluded: true })
    expect(chat.nodes[1]).toMatchObject({
      role: "system",
      excluded: false,
      parts: [{ type: "text", text: "The door opens." }],
    })
    expect(
      chat.nodes.map((node) => [node.id, node.parentId, node.selectedChildId])
    ).toEqual([
      ["m0s0", null, "m1s0"],
      ["m1s0", "m0s0", "m2s0"],
      ["m2s0", "m1s0", "m3s1"],
      ["m3s0", "m2s0", null],
      ["m3s1", "m2s0", null],
    ])
    expect(chat.nodes[4]).toMatchObject({
      sourceModel: "m",
      speaker: { name: "Ada" },
      parts: [
        { type: "text", text: "Second" },
        { type: "reasoning", text: "chosen" },
      ],
    })
  })

  it("associates group chats and ignores backup copies", async () => {
    const encoder = new TextEncoder()
    const { conversations } = await collect(
      files({
        "groups/team.json": encoder.encode(
          JSON.stringify({
            id: "team",
            name: "Research team",
            chats: ["planning"],
            members: ["ada", "lin"],
          })
        ),
        "group chats/planning.jsonl": encoder.encode(
          `${JSON.stringify({ chat_metadata: {} })}\n${JSON.stringify({ name: "Ada", mes: "Ready" })}`
        ),
        "backups/old.jsonl": encoder.encode(
          JSON.stringify({ name: "Old", mes: "Ignore me" })
        ),
      })
    )
    expect(conversations).toHaveLength(1)
    expect(conversations[0]?.entity).toMatchObject({
      id: "group:team",
      kind: "group",
    })
  })

  it("keeps attachments on their swipe and warns about missing files", async () => {
    const encoder = new TextEncoder()
    const {
      conversations: [chat],
    } = await collect(
      files({
        "Ada.jsonl": encoder.encode(
          `${JSON.stringify({ chat_metadata: { integrity: "chat-uuid" } })}\n${JSON.stringify({ name: "Ada", mes: "Chosen", swipes: ["Old", "Chosen"], swipe_id: 1, swipe_info: [{ extra: { media: [{ url: "/user/images/old.png" }] } }, { extra: { media: [{ url: "/user/images/chosen.png" }], files: [{ url: "https://example.test/file.pdf", name: "Elsewhere" }] } }] })}`
        ),
        "user/images/old.png": new Uint8Array([137, 80, 78, 71]),
        "user/images/chosen.png": new Uint8Array([137, 80, 78, 71]),
      })
    )
    expect(chat?.sourceId).toBe("integrity:chat-uuid")
    expect(chat?.sourceAliases).toEqual(["path:Ada.jsonl"])
    expect(chat?.nodes[0]?.parts).toContainEqual({
      type: "asset",
      assetId: "user/images/old.png",
    })
    expect(chat?.nodes[1]?.parts).toContainEqual({
      type: "asset",
      assetId: "user/images/chosen.png",
    })
    expect(chat?.warnings).toContain("Attachment unavailable: Elsewhere")
  })

  it("indexes a character card with no chats", async () => {
    const { conversations, entities } = await collect(
      files({
        "Ada.png": pngCard({
          spec: "chara_card_v2",
          data: { name: "Ada", description: "A researcher" },
        }),
      })
    )
    expect(conversations).toHaveLength(0)
    expect(entities).toMatchObject([
      {
        label: "Ada",
        kind: "character",
        variables: {
          character_name: "Ada",
          character_description: "A researcher",
        },
      },
    ])
  })
})
