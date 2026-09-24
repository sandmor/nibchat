import { describe, expect, it } from "vitest"
import { PRODUCT_DEFAULTS } from "@/lib/chat-settings/catalog"
import { resolveSettings } from "@/lib/chat-settings/resolve"
import type { SpaceRecord } from "@/lib/spaces/tree"

function space(
  id: string,
  parent_id: string | null,
  settings: SpaceRecord["settings"] = {},
  name = id
): SpaceRecord {
  return { id, parent_id, name, settings }
}

describe("resolveSettings", () => {
  it("inherits title fields independently from admin, user, and spaces", () => {
    const spaces = [
      space("work", null, {
        titleInstructions: { mode: "default", value: "Name by topic" },
        titleStrategy: { mode: "require", value: "first-message" },
      }),
    ]
    const resolved = resolveSettings({
      admin: {
        titleStrategy: "generate",
        titleModel: { providerId: "p", model: "m" },
        titleInstructions: "Admin prompt",
      },
      user: { titleModel: { providerId: "p", model: "fast" } },
      chat: { titleStrategy: "generate" },
      spaceId: "work",
      spaces,
    })
    expect(resolved.effective.title).toEqual({
      strategy: "first-message",
      model: { providerId: "p", model: "fast" },
      instructions: "Name by topic",
    })
    expect(resolved.sources.titleStrategy?.layer).toBe("space")
    expect(resolved.sources.titleModel?.layer).toBe("user")
  })
  it("uses product defaults when nobody sets a key", () => {
    const resolved = resolveSettings({ spaces: [] })
    expect(resolved.effective.model.contextScanDepth).toBe(
      PRODUCT_DEFAULTS.contextScanDepth
    )
    expect(resolved.sources.contextScanDepth).toEqual({ layer: "product" })
    expect(resolved.effective.promptStackId).toBeNull()
    expect(resolved.locks.promptStack).toBeUndefined()
  })

  it("lets user defaults win over product and yield to a chat write", () => {
    const user = {
      temperature: 0.4,
      contextScanDepth: 8,
      promptStack: "user-stack",
    }
    const inherited = resolveSettings({ user, spaces: [] })
    expect(inherited.effective.model.temperature).toBe(0.4)
    expect(inherited.effective.promptStackId).toBe("user-stack")
    expect(inherited.sources.temperature).toEqual({ layer: "user" })

    const chosen = resolveSettings({
      user,
      chat: { temperature: 0.9 },
      spaces: [],
    })
    expect(chosen.effective.model.temperature).toBe(0.9)
    expect(chosen.effective.promptStackId).toBe("user-stack")
    expect(chosen.sources.temperature).toEqual({ layer: "chat" })
    expect(chosen.locks.temperature).toBeUndefined()
  })

  it("locks required slots and ignores released ones", () => {
    const spaces = [
      space("work", null, {
        promptStack: { mode: "require", value: "stack-a" },
        chatTemplate: { mode: "require", value: "template-a" },
        temperature: { mode: "release", value: 0.1 },
      }),
    ]
    const resolved = resolveSettings({
      user: { temperature: 0.4 },
      chat: { promptStack: "chat-stack", temperature: 0.9 },
      spaceId: "work",
      spaces,
    })
    expect(resolved.effective.promptStackId).toBe("stack-a")
    expect(resolved.locks.promptStack?.spaceId).toBe("work")
    expect(resolved.effective.chatTemplateId).toBe("template-a")
    expect(resolved.locks.chatTemplate?.spaceId).toBe("work")
    expect(resolved.effective.model.temperature).toBe(0.9)
    expect(resolved.locks.temperature).toBeUndefined()
    expect(resolved.sources.temperature).toEqual({ layer: "chat" })
  })

  it("cascades field-by-field with innermost require winning", () => {
    const spaces = [
      space("root", null, {
        promptStack: { mode: "require", value: "parent-stack" },
        temperature: { mode: "require", value: 0.2 },
        model: { mode: "require", value: { providerId: "p1", model: "m1" } },
      }),
      space("leaf", "root", {
        temperature: { mode: "require", value: 0.9 },
      }),
    ]
    const resolved = resolveSettings({
      chat: { temperature: 0.1 },
      spaceId: "leaf",
      spaces,
    })
    expect(resolved.effective.promptStackId).toBe("parent-stack")
    expect(resolved.effective.model.providerId).toBe("p1")
    expect(resolved.effective.model.model).toBe("m1")
    expect(resolved.effective.model.temperature).toBe(0.9)
    expect(resolved.locks.temperature?.spaceId).toBe("leaf")
    expect(resolved.locks.model?.spaceId).toBe("root")
  })

  it("lets a space default yield to a chat write and a release restore the user", () => {
    const user = { temperature: 0.4 }
    const spaces = [
      space("root", null, {
        temperature: { mode: "require", value: 0.2 },
      }),
      space("soft", "root", {
        temperature: { mode: "default", value: 0.5 },
      }),
      space("released", "soft", {
        temperature: { mode: "release", value: 0 },
      }),
    ]
    const soft = resolveSettings({
      user,
      spaceId: "soft",
      spaces,
    })
    expect(soft.effective.model.temperature).toBe(0.5)
    expect(soft.locks.temperature).toBeUndefined()
    expect(soft.sources.temperature?.layer).toBe("space")

    const written = resolveSettings({
      user,
      chat: { temperature: 0.7 },
      spaceId: "soft",
      spaces,
    })
    expect(written.effective.model.temperature).toBe(0.7)

    const released = resolveSettings({
      user,
      chat: { temperature: 0.7 },
      spaceId: "released",
      spaces,
    })
    expect(released.effective.model.temperature).toBe(0.7)

    const releasedToUser = resolveSettings({
      user,
      spaceId: "released",
      spaces,
    })
    expect(releasedToUser.effective.model.temperature).toBe(0.4)
    expect(releasedToUser.sources.temperature).toEqual({ layer: "user" })
  })

  it("locks only the variables a space requires", () => {
    const spaces = [
      space("work", null, {
        variables: {
          tone: { mode: "require", value: "formal" },
          skipped: { mode: "release", value: "nope" },
        },
      }),
    ]
    const resolved = resolveSettings({
      user: { variables: { tone: "warm" } },
      chat: { variables: { tone: "casual", extra: true, skipped: "chat" } },
      spaceId: "work",
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

  it("resolves book exclusions and rule exceptions by branch", () => {
    const spaces = [
      space("root", null, {
        books: { reset: false, decisions: { a: "include", b: "include" } },
        rules: [
          { id: "tone", operation: "define", title: "Tone", content: "Formal" },
        ],
      }),
      space("child", "root", {
        books: {
          reset: false,
          decisions: { a: "exclude" },
          entries: { b: { entry: "disable" } },
        },
        rules: [
          {
            id: "tone",
            operation: "replace",
            title: "Tone",
            content: "Conversational",
          },
        ],
      }),
      space("leaf", "child", {
        books: { reset: false, decisions: { a: "include" } },
        rules: [{ id: "tone", operation: "disable" }],
      }),
    ]
    const child = resolveSettings({
      chat: {},
      spaceId: "child",
      spaces,
      contextBookIds: ["a", "chat"],
    })
    expect(child.effective.contextBookIds).toEqual(["b", "chat"])
    expect(child.effective.contextEntryDecisions).toEqual({
      b: { entry: "disable" },
    })
    expect(child.effective.rules[0]?.content).toBe("Conversational")

    const leaf = resolveSettings({ spaceId: "leaf", spaces })
    expect(leaf.effective.contextBookIds).toEqual(["a", "b"])
    expect(leaf.effective.rules).toEqual([])
  })
})
