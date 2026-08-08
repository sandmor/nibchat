import "server-only"
import { betterAuth } from "better-auth"
import { nextCookies } from "better-auth/next-js"
import { authDatabase, db, migrate } from "@/lib/db"

function resolveAuthSecret() {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET
  const isProdRuntime =
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  if (isProdRuntime)
    throw new Error(
      "BETTER_AUTH_SECRET is required in production. Copy .env.example to .env at the repo root and set BETTER_AUTH_SECRET."
    )
  return "development-only-change-me-development-only-change-me"
}

// Better Auth receives the same Kysely instance as the application; no ORM-specific schema leaks into the domain.
export const auth = betterAuth({
  database: authDatabase as never,
  secret: resolveAuthSecret(),
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  emailAndPassword: { enabled: true },
  plugins: [nextCookies()],
})

export async function sessionFromHeaders(headers: Headers) {
  await migrate()
  return auth.api.getSession({ headers })
}
export async function requireOwner(headers: Headers) {
  const session = await sessionFromHeaders(headers)
  if (!session) throw new Error("Unauthorized")
  const instance = await db
    .selectFrom("instance")
    .select("owner_user_id")
    .where("id", "=", 1)
    .executeTakeFirst()
  if (!instance?.owner_user_id) {
    await db
      .updateTable("instance")
      .set({ owner_user_id: session.user.id })
      .where("id", "=", 1)
      .where("owner_user_id", "is", null)
      .execute()
  }
  const claimed = await db
    .selectFrom("instance")
    .select("owner_user_id")
    .where("id", "=", 1)
    .executeTakeFirst()
  if (claimed?.owner_user_id !== session.user.id)
    throw new Error("This account is not the instance owner")
  return session.user
}
