import { describe, expect, it } from "vitest"
import Database from "better-sqlite3"
import { Kysely, SqliteDialect } from "kysely"
import { applySchema } from "@/lib/db/schema"
import type { DB } from "@/lib/types"

describe("applySchema", () => {
  it("creates core tables on sqlite", async () => {
    const sqlite = new Database(":memory:")
    sqlite.pragma("foreign_keys = ON")
    const db = new Kysely<DB>({
      dialect: new SqliteDialect({ database: sqlite }),
    })
    await applySchema(db, "sqlite")
    const instance = await db
      .selectFrom("instance")
      .select("id")
      .where("id", "=", 1)
      .executeTakeFirst()
    expect(instance?.id).toBe(1)
    // Tables exist and accept empty selects
    await db.selectFrom("chats").select("id").limit(1).execute()
    await db.selectFrom("message_nodes").select("id").limit(1).execute()
    await db.selectFrom("provider_profiles").select("id").limit(1).execute()
    await db.selectFrom("user").select("id").limit(1).execute()
    await db.destroy()
    sqlite.close()
  })

  it.skipIf(!process.env.DATABASE_URL)(
    "creates core tables on postgres when DATABASE_URL is set",
    async () => {
      const { createPostgresPort } = await import("@/lib/db/adapters/postgres")
      const port = createPostgresPort(process.env.DATABASE_URL)
      await port.migrate()
      const row = await port.db
        .selectFrom("instance")
        .select("id")
        .where("id", "=", 1)
        .executeTakeFirst()
      expect(row?.id).toBe(1)
      await port.destroy?.()
    }
  )
})
