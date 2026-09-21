import { describe, expect, it } from "vitest"
import {
  assertSpaceMoveAllowed,
  assertSpaceSettingsLocks,
  omitModelProviderRef,
  omitPromptStackRef,
  parseSpaceSettings,
  spaceChain,
  spaceDepth,
  spaceSettingsToJson,
  spaceSubtreeHeight,
  spaceSubtreeIds,
  type SpaceRecord,
} from "@/lib/spaces"
import { bindVariableLocksToStack } from "@/lib/chat-settings"

function space(
  id: string,
  parent_id: string | null,
  settings: SpaceRecord["settings"] = {},
  name = id
): SpaceRecord {
  return { id, parent_id, name, settings }
}

describe("parseSpaceSettings", () => {
  it("keeps known slots and drops invalid JSON", () => {
    expect(parseSpaceSettings("not-json")).toEqual({})
    expect(
      parseSpaceSettings(
        '{"unknown":true,"temperature":{"mode":"require","value":0.2}}'
      )
    ).toEqual({ temperature: { mode: "require", value: 0.2 } })
  })

  it("round-trips a defined-but-disabled slot", () => {
    const settings: SpaceRecord["settings"] = {
      promptStack: { mode: "release", value: "stack-1" },
      temperature: { mode: "require", value: 0.2 },
    }
    expect(parseSpaceSettings(spaceSettingsToJson(settings))).toEqual(settings)
  })

  it("refuses to serialize an enabled model without identity", () => {
    expect(() =>
      spaceSettingsToJson({
        model: { mode: "require", value: {} },
      })
    ).toThrow(/provider and model/i)
    expect(() =>
      assertSpaceSettingsLocks({
        maxOutputTokens: { mode: "require", value: 0 },
      })
    ).toThrow(/greater than 0/i)
  })
})

describe("omit*Ref", () => {
  it("drops only the matching prompt-stack slot", () => {
    const settings: SpaceRecord["settings"] = {
      promptStack: { mode: "require", value: "stack-1" },
      temperature: { mode: "require", value: 0.2 },
    }
    expect(omitPromptStackRef(settings, "stack-1")).toEqual({
      temperature: { mode: "require", value: 0.2 },
    })
    expect(omitPromptStackRef(settings, "other")).toEqual(settings)
  })

  it("drops only the matching model provider slot", () => {
    const settings: SpaceRecord["settings"] = {
      model: { mode: "require", value: { providerId: "p1", model: "m1" } },
      temperature: { mode: "require", value: 0.2 },
    }
    expect(omitModelProviderRef(settings, "p1")).toEqual({
      temperature: { mode: "require", value: 0.2 },
    })
    expect(omitModelProviderRef(settings, "other")).toEqual(settings)
  })
})

describe("bindVariableLocksToStack", () => {
  it("drops locks for names not on the effective stack", () => {
    const bound = bindVariableLocksToStack(
      {
        variables: {
          tone: { spaceId: "work", spaceName: "Work" },
          gone: { spaceId: "work", spaceName: "Work" },
        },
      },
      ["tone"]
    )
    expect(bound.variables.tone?.spaceId).toBe("work")
    expect(bound.variables.gone).toBeUndefined()
  })
})

describe("space tree helpers", () => {
  const spaces = [
    space("root", null),
    space("mid", "root"),
    space("leaf", "mid"),
    space("other", null),
  ]

  it("walks ancestors and measures the tree", () => {
    const byId = new Map(spaces.map((item) => [item.id, item]))
    expect(spaceChain("leaf", byId).map((item) => item.id)).toEqual([
      "root",
      "mid",
      "leaf",
    ])
    expect(spaceDepth("leaf", byId)).toBe(3)
    expect(spaceSubtreeHeight("root", spaces)).toBe(3)
    expect(spaceSubtreeHeight("leaf", spaces)).toBe(1)
    expect([...spaceSubtreeIds("root", spaces)].sort()).toEqual([
      "leaf",
      "mid",
      "root",
    ])
    expect([...spaceSubtreeIds("mid", spaces)].sort()).toEqual(["leaf", "mid"])
  })

  it("rejects a move that would nest a space inside itself", () => {
    expect(() => assertSpaceMoveAllowed("root", "leaf", spaces)).toThrow(
      /cannot contain itself/
    )
    expect(() => assertSpaceMoveAllowed("leaf", "other", spaces)).not.toThrow()
  })
})
