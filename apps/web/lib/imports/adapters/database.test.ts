import { beforeAll, describe, expect, it } from "vitest"
import { db, migrate } from "@/lib/db"
import {
  appendImportNodes,
  beginImport,
  getOrCreateImportSpace,
  publishImport,
  resolveImportSpace,
  resolveImportBook,
} from "@/lib/imports/adapters/database"

const userId = "import-test-user"
const scope = {
  userId,
  source: "test-source",
  parserVersion: 1,
  conversationId: "source-conversation",
}
const timestamp = "2025-01-01T00:00:00.000Z"

beforeAll(async () => {
  await migrate()
  await db
    .insertInto("user")
    .values({
      id: userId,
      name: "Importer",
      email: "importer@test.local",
      emailVerified: 1 as unknown as boolean,
      image: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .execute()
})

describe("database import adapter", () => {
  it("publishes once and returns the durable receipt on retry", async () => {
    const space = await getOrCreateImportSpace(userId, scope.source, "Test")
    const manifest = {
      sourceId: scope.conversationId,
      fingerprint: "a".repeat(64),
      title: "Imported",
      createdAt: timestamp,
      updatedAt: timestamp,
      nodeCount: 2,
      selectedRootId: "user",
      variables: { imported_location: "library" },
      spaceId: space.id,
    }
    expect(await beginImport(scope, manifest)).toMatchObject({
      status: "staging",
      nextNode: 0,
    })
    await appendImportNodes(scope, 0, [
      {
        id: "user",
        parentId: null,
        selectedChildId: "assistant",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
        createdAt: timestamp,
        excluded: false,
      },
      {
        id: "assistant",
        parentId: "user",
        selectedChildId: null,
        role: "assistant",
        parts: [{ type: "text", text: "Hi" }],
        createdAt: timestamp,
        sourceModel: "test-model",
        sourceApi: "openrouter",
        speaker: { name: "Ada" },
        excluded: false,
      },
    ])
    const first = await publishImport(scope, manifest.fingerprint)
    expect(first.status).toBe("imported")
    expect(
      await db
        .selectFrom("message_nodes")
        .select("id")
        .where("chat_id", "=", first.chatId!)
        .execute()
    ).toHaveLength(2)
    const published = await db
      .selectFrom("chats")
      .select("settings_json")
      .where("id", "=", first.chatId!)
      .executeTakeFirstOrThrow()
    expect(JSON.parse(published.settings_json).variables).toEqual({
      imported_location: "library",
    })
    const assistant = await db
      .selectFrom("message_nodes")
      .select("metadata_json")
      .where("chat_id", "=", first.chatId!)
      .where("role", "=", "assistant")
      .executeTakeFirstOrThrow()
    expect(assistant.metadata_json).toContain('"speaker":{"name":"Ada"}')
    expect(assistant.metadata_json).toContain('"sourceApi":"openrouter"')
    expect(await beginImport(scope, manifest)).toEqual({
      status: "skipped",
      chatId: first.chatId,
    })
    await db.deleteFrom("chats").where("id", "=", first.chatId!).execute()
    expect(await beginImport(scope, manifest)).toMatchObject({
      status: "staging",
      nextNode: 0,
    })
  })

  it("rolls back the chat when graph validation fails", async () => {
    const invalid = { ...scope, conversationId: "invalid-conversation" }
    const space = await getOrCreateImportSpace(userId, scope.source, "Test")
    await beginImport(invalid, {
      sourceId: invalid.conversationId,
      fingerprint: "b".repeat(64),
      title: "Invalid",
      createdAt: timestamp,
      updatedAt: timestamp,
      nodeCount: 1,
      selectedRootId: "orphan",
      spaceId: space.id,
    })
    await appendImportNodes(invalid, 0, [
      {
        id: "orphan",
        parentId: "missing",
        selectedChildId: null,
        role: "assistant",
        parts: [{ type: "text", text: "Orphan" }],
        createdAt: timestamp,
        excluded: false,
      },
    ])
    await expect(publishImport(invalid, "b".repeat(64))).rejects.toThrow(
      "unknown parent"
    )
    expect(
      await db
        .selectFrom("chats")
        .select("id")
        .where("title", "=", "Invalid")
        .execute()
    ).toHaveLength(0)
  })

  it("creates a managed character space without conversations", async () => {
    const root = await getOrCreateImportSpace(
      userId,
      "st-character-only",
      "SillyTavern"
    )
    const space = await resolveImportSpace({
      userId,
      source: "st-character-only",
      entityId: "character:ada",
      mode: "managed",
      rootSpaceId: root.id,
      label: "Ada",
      settings: {
        variables: {
          character_name: { mode: "require", value: "Ada" },
        },
      },
    })
    expect(space.name).toBe("Ada")
    expect(space.parent_id).toBe(root.id)
    expect(space.settings_json).toContain("character_name")
  })

  it("updates a managed character space when the same entity is reimported", async () => {
    const source = `managed-reuse-${crypto.randomUUID()}`
    const root = await getOrCreateImportSpace(userId, source, "Imports")
    const created = await resolveImportSpace({
      userId,
      source,
      entityId: "character:reuse",
      mode: "managed",
      rootSpaceId: root.id,
      label: "Reuse",
      settings: {
        chatTemplate: { mode: "default", value: "template-original" },
      },
    })
    await db
      .updateTable("spaces")
      .set({ settings_json: "{}" })
      .where("id", "=", created.id)
      .execute()

    const updated = await resolveImportSpace({
      userId,
      source,
      entityId: "character:reuse",
      mode: "managed",
      rootSpaceId: root.id,
      label: "Reuse renamed upstream",
      settings: {
        chatTemplate: { mode: "default", value: "template-reimported" },
      },
    })

    expect(updated.id).toBe(created.id)
    expect(updated.name).toBe("Reuse renamed upstream")
    expect(updated.settings_json).toContain("template-reimported")
  })

  it("reuses an imported context book without overwriting edits", async () => {
    const source = `book-reuse-${crypto.randomUUID()}`
    const first = await resolveImportBook({
      userId,
      source,
      entityId: "path:worlds/Castle.json",
      name: "Castle",
      book: sampleBook("A keep."),
    })
    expect(first.created).toBe(true)
    const same = await resolveImportBook({
      userId,
      source,
      entityId: "path:worlds/Castle.json",
      name: "Castle",
      book: sampleBook("A keep."),
    })
    expect(same).toMatchObject({
      id: first.id,
      created: false,
      replaced: false,
      changed: false,
    })
    await db
      .updateTable("context_books")
      .set({ name: "Edited castle", book_json: '{"version":1,"entries":[]}' })
      .where("id", "=", first.id)
      .execute()

    const reused = await resolveImportBook({
      userId,
      source,
      entityId: "path:worlds/Castle.json",
      name: "Castle from a new export",
      book: sampleBook("Updated keep."),
    })
    expect(reused).toMatchObject({
      created: false,
      replaced: false,
      changed: true,
    })
    expect(reused.id).toBe(first.id)
    expect(reused.name).toBe("Edited castle")
    const stored = await db
      .selectFrom("context_books")
      .select("book_json")
      .where("id", "=", first.id)
      .executeTakeFirstOrThrow()
    expect(stored.book_json).toBe('{"version":1,"entries":[]}')
  })

  it("replaces an imported context book when asked", async () => {
    const source = `book-replace-${crypto.randomUUID()}`
    const first = await resolveImportBook({
      userId,
      source,
      entityId: "path:worlds/Keep.json",
      name: "Keep",
      book: sampleBook("Original."),
    })
    await db
      .updateTable("context_books")
      .set({ name: "Local keep", book_json: '{"version":1,"entries":[]}' })
      .where("id", "=", first.id)
      .execute()

    const replaced = await resolveImportBook({
      userId,
      source,
      entityId: "path:worlds/Keep.json",
      name: "Keep from export",
      book: sampleBook("From export."),
      replace: true,
    })
    expect(replaced).toMatchObject({
      id: first.id,
      name: "Keep from export",
      created: false,
      replaced: true,
      changed: true,
    })
    const stored = await db
      .selectFrom("context_books")
      .select("book_json")
      .where("id", "=", first.id)
      .executeTakeFirstOrThrow()
    expect(stored.book_json).toContain("From export.")
  })
})

function sampleBook(content: string) {
  return {
    version: 1 as const,
    entries: [
      {
        id: "1",
        title: "Keep",
        enabled: true,
        content,
        namespace: "default",
        activation: { kind: "always" as const },
        priority: 100,
      },
    ],
    scanRoles: ["user" as const, "assistant" as const],
    tokenBudget: null,
  }
}
