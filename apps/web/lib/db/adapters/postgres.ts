import "server-only"
import { Kysely, PostgresDialect } from "kysely"
import { Pool } from "pg"
import type { DB } from "@/lib/types"
import type { DbPort } from "@/lib/db/port"
import { applySchema } from "@/lib/db/schema"

export function createPostgresPort(
  connectionString = process.env.DATABASE_URL
): DbPort {
  if (!connectionString)
    throw new Error("DATABASE_URL is required for the Postgres adapter")

  const pool = new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 8),
  })
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
  })

  let migrated: Promise<void> | undefined

  return {
    kind: "postgres",
    db,
    // Better Auth Kysely adapter config (not the raw Pool).
    authDatabase: { db, type: "postgres" as const, transaction: false },
    migrate() {
      if (!migrated) migrated = applySchema(db, "postgres")
      return migrated
    },
    async destroy() {
      await db.destroy()
      await pool.end()
    },
  }
}
