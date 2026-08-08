import "server-only"
import Database from "better-sqlite3"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { Kysely, SqliteDialect } from "kysely"
import type { DB } from "@/lib/types"
import type { DbPort } from "@/lib/db/port"
import { applySchema } from "@/lib/db/schema"
import { resolveSqlitePath } from "@/lib/db/paths"

export function createSqlitePort(path = resolveSqlitePath()): DbPort {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
  const sqlite = new Database(path)
  sqlite.pragma("foreign_keys = ON")
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("busy_timeout = 5000")

  const db = new Kysely<DB>({
    dialect: new SqliteDialect({ database: sqlite }),
  })

  let migrated: Promise<void> | undefined

  return {
    kind: "sqlite",
    db,
    authDatabase: sqlite,
    migrate() {
      if (!migrated) migrated = applySchema(db, "sqlite")
      return migrated
    },
    async destroy() {
      await db.destroy()
      sqlite.close()
    },
  }
}
