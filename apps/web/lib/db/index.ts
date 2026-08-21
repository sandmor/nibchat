import "server-only"
import type { DbPort } from "@/lib/db/port"
import { createPostgresPort } from "@/lib/db/adapters/postgres"
import { createSqlitePort } from "@/lib/db/adapters/sqlite"

const globalForDb = globalThis as unknown as {
  nibchatDbPort?: DbPort
}

function selectPort(): DbPort {
  if (process.env.DATABASE_URL) return createPostgresPort()
  return createSqlitePort()
}

export const port: DbPort = globalForDb.nibchatDbPort ?? selectPort()
globalForDb.nibchatDbPort = port

/** Application Kysely client (both adapters expose the same interface). */
export const db = port.db

/** Better Auth driver binding from the active adapter. */
export const authDatabase = port.authDatabase

export const databaseKind = port.kind

/** SQLite drivers reject JS booleans; Postgres wants real booleans. */
export function toDbBool(value: boolean): boolean {
  if (port.kind === "sqlite") return (value ? 1 : 0) as unknown as boolean
  return value
}

export function fromDbBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1"
}

export function migrate() {
  return port.migrate()
}

export type { DbPort, DbKind } from "@/lib/db/port"
