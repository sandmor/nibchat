import { describe, expect, it } from "vitest"
import type { ImportArchivePort } from "@/lib/imports/model"
import {
  extractSillyTavernWorldInfo,
  importSillyTavernWorldInfo,
} from "@/lib/imports/silly-tavern-world-info"

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

function jsonFile(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value))
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

const castleEntry = {
  uid: 1,
  comment: "Castle",
  key: ["castle", "fortress"],
  keysecondary: ["north"],
  selectiveLogic: 1,
  content: "Welcome {{char}}.",
  position: 7,
  outletName: "background",
  order: 250,
}

describe("SillyTavern World Info import", () => {
  it("maps deterministic entries and outlets", () => {
    const result = importSillyTavernWorldInfo({
      name: "World",
      entries: { 1: castleEntry },
    })
    expect(result.name).toBe("World")
    expect(result.issues).toEqual([])
    expect(result.book.entries[0]).toMatchObject({
      title: "Castle",
      enabled: true,
      namespace: "background",
      priority: 250,
      content: "Welcome {{character_name}}.",
      activation: {
        kind: "match",
        keywords: ["castle", "fortress"],
        secondary: ["north"],
        secondaryMatch: "all",
      },
    })
  })

  it("disables entries whose behavior cannot be preserved", () => {
    const result = importSillyTavernWorldInfo({
      entries: [
        {
          uid: 2,
          key: ["/dragons?/i"],
          content: "Dragon lore",
          probability: 50,
          useProbability: true,
        },
      ],
    })
    expect(result.book.entries[0]?.enabled).toBe(false)
    expect(result.issues[0]?.reason).toContain("probability")
    expect(result.issues[0]?.reason).toContain("regular expressions")
  })
})

describe("SillyTavern World Info extraction", () => {
  it("reads loose JSON, worlds/, JSON cards, and embedded PNG books", async () => {
    const found = await extractSillyTavernWorldInfo(
      files({
        "Castle.json": jsonFile({
          name: "Castle",
          entries: { 1: castleEntry },
        }),
        "worlds/Forest.json": jsonFile({
          name: "Forest",
          entries: {
            1: { uid: 3, key: ["trees"], content: "Pines", position: 7 },
          },
        }),
        "Ada.json": jsonFile({
          spec: "chara_card_v2",
          data: {
            name: "Ada",
            character_book: {
              entries: [
                {
                  uid: 4,
                  key: ["lab"],
                  content: "{{char}}'s lab",
                  position: 7,
                },
              ],
            },
          },
        }),
        "characters/Bea.png": pngCard({
          spec: "chara_card_v2",
          data: {
            name: "Bea",
            character_book: {
              entries: [
                { uid: 5, key: ["sea"], content: "The harbor", position: 7 },
              ],
            },
          },
        }),
        "settings.json": jsonFile({ firstTime: false }),
      })
    )
    expect(found.map((item) => item.name).sort()).toEqual([
      "Ada context",
      "Bea context",
      "Castle",
      "Forest",
    ])
    const ada = found.find((item) => item.name === "Ada context")
    expect(ada?.fromCharacter).toBe(true)
    expect(ada?.book.entries[0]?.content).toBe("{{character_name}}'s lab")
  })
})
