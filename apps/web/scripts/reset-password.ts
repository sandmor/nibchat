/**
 * Insert a one-time password-reset verification token for the given owner email.
 * Usage: pnpm --filter web reset-password -- owner@example.com
 */
import { randomBytes, randomUUID } from "node:crypto"
import { monorepoRoot } from "../lib/db/paths"
import { loadRootEnv } from "../lib/root-env"

loadRootEnv(monorepoRoot())

const { db, migrate } = await import("../lib/db")

const email = process.argv[2]
const baseUrl = (
  process.env.BETTER_AUTH_URL || "http://localhost:3000"
).replace(/\/$/, "")

if (!email) {
  console.error("Usage: pnpm --filter web reset-password owner@example.com")
  process.exit(1)
}

await migrate()

const user = await db
  .selectFrom("user")
  .select("id")
  .where("email", "=", email)
  .executeTakeFirst()

if (!user) {
  console.error(
    "No account with that email. Ensure the instance has been started and migrated."
  )
  process.exit(1)
}

const token = randomBytes(24).toString("base64url")
const now = new Date()
const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString()
const iso = now.toISOString()

await db
  .insertInto("verification")
  .values({
    id: randomUUID(),
    identifier: `reset-password:${token}`,
    value: user.id,
    expiresAt,
    createdAt: iso,
    updatedAt: iso,
  })
  .execute()

console.log(
  `One-time reset URL (expires ${expiresAt}):\n${baseUrl}/reset-password?token=${encodeURIComponent(token)}`
)
