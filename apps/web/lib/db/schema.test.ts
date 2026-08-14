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
    await db.selectFrom("chats").select("id").limit(1).execute()
    await db.selectFrom("message_nodes").select("id").limit(1).execute()
    const columns = sqlite.prepare("pragma table_info(message_nodes)").all() as Array<{
      name: string
      notnull: number
      dflt_value: string | null
    }>
    expect(columns).toContainEqual(
      expect.objectContaining({
        name: "excluded_from_context",
        notnull: 1,
        dflt_value: "false",
      })
    )
    await db.selectFrom("provider_profiles").select("id").limit(1).execute()
    await db.selectFrom("prompt_stacks").select("id").limit(1).execute()
    await db.selectFrom("themes").select("id").limit(1).execute()
    await db.selectFrom("user").select("id").limit(1).execute()
    await db.selectFrom("attachments").select("id").limit(1).execute()
    await db
      .selectFrom("message_attachments")
      .select("attachment_id")
      .limit(1)
      .execute()
    const defaultStack = await db
      .selectFrom("prompt_stacks")
      .select("id")
      .where("id", "=", "default")
      .executeTakeFirst()
    expect(defaultStack?.id).toBe("default")
    const instance = await db
      .selectFrom("instance")
      .select(["id", "default_prompt_stack_id", "light_theme_id", "dark_theme_id"])
      .where("id", "=", 1)
      .executeTakeFirst()
    expect(instance?.default_prompt_stack_id).toBe("default")
    expect(instance?.light_theme_id).toBe("paper")
    expect(instance?.dark_theme_id).toBe("ink")
    const paper = await db
      .selectFrom("themes")
      .select("id")
      .where("id", "=", "paper")
      .executeTakeFirst()
    expect(paper?.id).toBe("paper")
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
