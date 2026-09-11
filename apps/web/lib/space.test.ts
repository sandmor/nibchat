import { describe, expect, it } from "vitest"
import {
  assertSpaceMoveAllowed,
  assertSpaceSettingsLocks,
  bindVariableLocksToStack,
  mergeUnlockedModelConfig,
  mergeUnlockedVariables,
  omitModelProviderRef,
  omitPromptStackRef,
  parseSpaceSettings,
  resolveChatSettings,
  spaceChain,
  spaceDepth,
  spaceSettingsToJson,
  spaceSubtreeHeight,
  type ChatSettingsSource,
  type SpaceRecord,
} from "@/lib/space"
import type { ModelConfig } from "@/lib/providers"

function space(
  id: string,
  parent_id: string | null,
  settings: SpaceRecord["settings"] = {},
  name = id
): SpaceRecord {
  return { id, parent_id, name, settings }
}

function chat(patch: Partial<ChatSettingsSource> = {}): ChatSettingsSource {
  return {
    spaceId: null,
    promptStackId: null,
    variables: {},
    model: { providerId: "p", model: "m", temperature: 0.7 },
    ...patch,
  }
}

describe("parseSpaceSettings", () => {
  it("keeps known slots and drops invalid JSON", () => {
    expect(parseSpaceSettings("not-json")).toEqual({})
    expect(
      parseSpaceSettings(
        '{"unknown":true,"temperature":{"enabled":true,"value":0.2}}'
      )
    ).toEqual({ temperature: { enabled: true, value: 0.2 } })
  })

  it("round-trips a defined-but-disabled slot", () => {
    const settings = {
      promptStack: { enabled: false, value: "stack-1" },
      temperature: { enabled: true, value: 0.2 },
    }
    expect(parseSpaceSettings(spaceSettingsToJson(settings))).toEqual(settings)
  })

  it("refuses to serialize an enabled model without identity", () => {
    expect(() =>
      spaceSettingsToJson({
        model: { enabled: true, value: {} },
      })
    ).toThrow(/provider and model/i)
    expect(() =>
      assertSpaceSettingsLocks({
        maxOutputTokens: { enabled: true, value: 0 },
      })
    ).toThrow(/greater than 0/i)
  })
})

describe("resolveChatSettings", () => {
  it("uses stored chat values when ungrouped", () => {
    const stored = chat({
      promptStackId: "mine",
      variables: { tone: "casual" },
    })
    const resolved = resolveChatSettings({ chat: stored, spaces: [] })
    expect(resolved.effective.promptStackId).toBe("mine")
    expect(resolved.effective.variables).toEqual({ tone: "casual" })
    expect(resolved.effective.model.temperature).toBe(0.7)
    expect(resolved.locks.promptStack).toBeUndefined()
    expect(resolved.chain).toEqual([])
  })

  it("locks enabled slots and ignores disabled ones", () => {
    const spaces = [
      space("work", null, {
        promptStack: { enabled: true, value: "stack-a" },
        temperature: { enabled: false, value: 0.1 },
      }),
    ]
    const resolved = resolveChatSettings({
      chat: chat({
        spaceId: "work",
        promptStackId: "chat-stack",
        model: { providerId: "p", model: "m", temperature: 0.9 },
      }),
      spaces,
    })
    expect(resolved.effective.promptStackId).toBe("stack-a")
    expect(resolved.effective.model.temperature).toBe(0.9)
    expect(resolved.locks.promptStack?.spaceId).toBe("work")
    expect(resolved.locks.temperature).toBeUndefined()
  })

  it("cascades field-by-field with innermost enabled winning", () => {
    const spaces = [
      space("root", null, {
        promptStack: { enabled: true, value: "parent-stack" },
        temperature: { enabled: true, value: 0.2 },
        model: { enabled: true, value: { providerId: "p1", model: "m1" } },
      }),
      space("leaf", "root", {
        temperature: { enabled: true, value: 0.9 },
      }),
    ]
    const resolved = resolveChatSettings({
      chat: chat({ spaceId: "leaf" }),
      spaces,
    })
    expect(resolved.effective.promptStackId).toBe("parent-stack")
    expect(resolved.effective.model.providerId).toBe("p1")
    expect(resolved.effective.model.model).toBe("m1")
    expect(resolved.effective.model.temperature).toBe(0.9)
    expect(resolved.locks.promptStack?.spaceId).toBe("root")
    expect(resolved.locks.model?.spaceId).toBe("root")
    expect(resolved.locks.temperature?.spaceId).toBe("leaf")
  })

  it("locks only the variables the space enables", () => {
    const spaces = [
      space("work", null, {
        variables: {
          tone: { enabled: true, value: "formal" },
          skipped: { enabled: false, value: "nope" },
        },
      }),
    ]
    const resolved = resolveChatSettings({
      chat: chat({
        spaceId: "work",
        variables: { tone: "casual", extra: true, skipped: "chat" },
      }),
      spaces,
    })
    expect(resolved.effective.variables).toEqual({
      tone: "formal",
      extra: true,
      skipped: "chat",
    })
    expect(resolved.locks.variables.tone?.spaceId).toBe("work")
    expect(resolved.locks.variables.skipped).toBeUndefined()
    expect(resolved.locks.variables.extra).toBeUndefined()
  })
})

describe("bindVariableLocksToStack", () => {
  it("drops locks for names not on the effective stack", () => {
    const spaces = [
      space("work", null, {
        variables: {
          tone: { enabled: true, value: "formal" },
          gone: { enabled: true, value: "x" },
        },
      }),
    ]
    const resolved = resolveChatSettings({
      chat: chat({ spaceId: "work" }),
      spaces,
    })
    const bound = bindVariableLocksToStack(resolved.locks, ["tone"])
    expect(bound.variables.tone).toEqual(resolved.locks.variables.tone)
    expect(bound.variables.gone).toBeUndefined()
  })
})

describe("omit*Ref", () => {
  it("drops only the matching prompt-stack slot", () => {
    const settings = {
      promptStack: { enabled: true, value: "stack-1" },
      temperature: { enabled: true, value: 0.2 },
    }
    expect(omitPromptStackRef(settings, "stack-1")).toEqual({
      temperature: { enabled: true, value: 0.2 },
    })
    expect(omitPromptStackRef(settings, "other")).toEqual(settings)
  })

  it("drops only the matching model provider slot", () => {
    const settings = {
      model: { enabled: true, value: { providerId: "p1", model: "m1" } },
      temperature: { enabled: true, value: 0.2 },
    }
    expect(omitModelProviderRef(settings, "p1")).toEqual({
      temperature: { enabled: true, value: 0.2 },
    })
    expect(omitModelProviderRef(settings, "other")).toEqual(settings)
  })
})

describe("mergeUnlocked*", () => {
  it("keeps stored model fields that a space locks", () => {
    const stored: ModelConfig = {
      providerId: "stored-p",
      model: "stored-m",
      temperature: 0.4,
      topP: 0.8,
    }
    const incoming: ModelConfig = {
      providerId: "ui-p",
      model: "ui-m",
      temperature: 0.1,
      topP: 0.2,
    }
    const merged = mergeUnlockedModelConfig(stored, incoming, {
      variables: {},
      model: { spaceId: "s", spaceName: "Work" },
      temperature: { spaceId: "s", spaceName: "Work" },
    })
    expect(merged.providerId).toBe("stored-p")
    expect(merged.model).toBe("stored-m")
    expect(merged.temperature).toBe(0.4)
    expect(merged.topP).toBe(0.2)
  })

  it("keeps stored values for locked variables", () => {
    const merged = mergeUnlockedVariables(
      { tone: "casual", extra: true },
      { tone: "formal", extra: false, other: "x" },
      {
        variables: { tone: { spaceId: "s", spaceName: "Work" } },
      },
      ["tone", "extra", "other"]
    )
    expect(merged).toEqual({ tone: "casual", extra: false, other: "x" })
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
  })

  it("rejects a move that would nest a space inside itself", () => {
    expect(() => assertSpaceMoveAllowed("root", "leaf", spaces)).toThrow(
      /cannot contain itself/
    )
    expect(() => assertSpaceMoveAllowed("leaf", "other", spaces)).not.toThrow()
  })
})
