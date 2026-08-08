import type { Kysely } from "kysely"
import type { DB } from "@/lib/types"

/** Dialect-independent database port used by the app. */
export type DbKind = "sqlite" | "postgres"

export interface DbPort {
  readonly kind: DbKind
  readonly db: Kysely<DB>
  /**
   * Driver binding for Better Auth (native sqlite handle, or Kysely postgres
   * config). Adapters own the exact shape.
   */
  readonly authDatabase: unknown
  /** Apply the current schema (version 1 only) and any boot-time maintenance. */
  migrate(): Promise<void>
  /** Close underlying connections (tests / scripts). */
  destroy?(): Promise<void>
}
