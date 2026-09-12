import { beforeAll, describe, expect, it } from "vitest"
import { db, migrate } from "@/lib/db"
import {
  appendImportNodes,
  beginImport,
  getOrCreateImportSpace,
  publishImport,
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
})
