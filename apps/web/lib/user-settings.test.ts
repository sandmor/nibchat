import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { db, migrate, toDbBool } from "@/lib/db"
import {
  getBuiltInToolsPrefs,
  setBuiltInToolsPrefs,
  setChatDefaults,
} from "@/lib/user-settings"
import { defaultModelConfig } from "@/lib/providers"
import { createChat } from "@/lib/chat-service"

const ownerId = "builtin-tools-owner"
const guestId = "builtin-tools-guest"

async function ensureUser(id: string, email: string) {
  const existing = await db
    .selectFrom("user")
    .select("id")
    .where("id", "=", id)
    .executeTakeFirst()
  if (existing) return
  await db
    .insertInto("user")
    .values({
      id,
      name: id,
      email,
      emailVerified: toDbBool(true),
      image: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .execute()
}

beforeAll(async () => {
  await migrate()
  await ensureUser(ownerId, "builtin-owner@test.local")
  await ensureUser(guestId, "builtin-guest@test.local")
})

beforeEach(async () => {
  await setBuiltInToolsPrefs(ownerId, [])
  await setBuiltInToolsPrefs(guestId, [])
})

describe("built-in tool preferences", () => {
  it("defaults to all tools enabled", async () => {
    expect(await getBuiltInToolsPrefs(ownerId)).toEqual({ disabled: [] })
  })

  it("persists a disabled list per user", async () => {
    await setBuiltInToolsPrefs(ownerId, ["question", "unknown"])
    expect(await getBuiltInToolsPrefs(ownerId)).toEqual({
      disabled: ["question"],
    })
    expect(await getBuiltInToolsPrefs(guestId)).toEqual({ disabled: [] })

    await setBuiltInToolsPrefs(guestId, ["question"])
    expect(await getBuiltInToolsPrefs(ownerId)).toEqual({
      disabled: ["question"],
    })
    expect(await getBuiltInToolsPrefs(guestId)).toEqual({
      disabled: ["question"],
    })

    await setBuiltInToolsPrefs(ownerId, [])
    expect(await getBuiltInToolsPrefs(ownerId)).toEqual({ disabled: [] })
    expect(await getBuiltInToolsPrefs(guestId)).toEqual({
      disabled: ["question"],
    })
  })
})

describe("new chat defaults", () => {
  it("seeds new chats from saved defaults instead of recent chats", async () => {
    await setChatDefaults(ownerId, {
      contextScanDepth: 8,
      temperature: 0.4,
    })
    const baseline = await defaultModelConfig(ownerId)
    expect(JSON.parse((await createChat(ownerId)).model_config_json)).toEqual(
      baseline
    )
    await createChat(ownerId, "Custom chat", {
      contextScanDepth: 100,
      temperature: 1.2,
    })
    expect(await defaultModelConfig(ownerId)).toEqual(baseline)
  })
})
