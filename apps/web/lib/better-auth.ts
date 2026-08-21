import "server-only"
import { betterAuth } from "better-auth"
import { nextCookies } from "better-auth/next-js"
import { admin } from "better-auth/plugins"
import { authDatabase } from "@/lib/db"

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

/** Better Auth instance only — no app gate logic (avoids circular imports). */
export const auth = betterAuth({
  database: authDatabase as never,
  secret: resolveAuthSecret(),
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  emailAndPassword: { enabled: true },
  plugins: [
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
      bannedUserMessage: "This account has been disabled by the instance owner.",
    }),
    nextCookies(),
  ],
})
