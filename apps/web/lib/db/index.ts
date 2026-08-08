import "server-only"
import type { DbPort } from "@/lib/db/port"
import { createPostgresPort } from "@/lib/db/adapters/postgres"
import { createSqlitePort } from "@/lib/db/adapters/sqlite"

const globalForDb = globalThis as unknown as {
  veroDbPort?: DbPort
}

function selectPort(): DbPort {
  if (process.env.DATABASE_URL) return createPostgresPort()
  return createSqlitePort()
}

export const port: DbPort = globalForDb.veroDbPort ?? selectPort()
globalForDb.veroDbPort = port

/** Application Kysely client (both adapters expose the same interface). */
export const db = port.db

/** Better Auth driver binding from the active adapter. */
export const authDatabase = port.authDatabase

export const databaseKind = port.kind

export function migrate() {
  return port.migrate()
}

export type { DbPort, DbKind } from "@/lib/db/port"
