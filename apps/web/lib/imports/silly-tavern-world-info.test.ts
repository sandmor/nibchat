import { describe, expect, it } from "vitest"
import { importSillyTavernWorldInfo } from "@/lib/imports/silly-tavern-world-info"

describe("SillyTavern World Info import", () => {
  it("maps deterministic entries and outlets", () => {
    const result = importSillyTavernWorldInfo({
      name: "World",
      entries: {
        1: {
          uid: 1,
          comment: "Castle",
          key: ["castle", "fortress"],
          keysecondary: ["north"],
          selectiveLogic: 1,
          content: "A northern castle.",
          position: 7,
          outletName: "background",
          order: 250,
        },
      },
    })
    expect(result.name).toBe("World")
    expect(result.issues).toEqual([])
    expect(result.book.entries[0]).toMatchObject({
      title: "Castle",
      enabled: true,
      namespace: "background",
      priority: 250,
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
