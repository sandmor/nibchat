import type { IdentityPorts } from "@/lib/identity/ports"
import { createBetterAuthSessionPort } from "@/lib/identity/adapters/better-auth-session"
import { createKyselyInstanceOwnerPort } from "@/lib/identity/adapters/kysely-instance"
import { createSchemaPort } from "@/lib/identity/adapters/schema"

/** Composition root for production routes (tests pass fakes into resolve). */
export const defaultIdentityPorts: IdentityPorts = {
  session: createBetterAuthSessionPort(),
  instance: createKyselyInstanceOwnerPort(),
  schema: createSchemaPort(),
}
