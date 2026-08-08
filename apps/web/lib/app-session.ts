/**
 * App-facing identity façade — single import surface for gate + owner checks.
 *
 * RSC: getRequestGate / requireWorkspaceUser / workspaceHomePath
 * API: requireOwner / resolveAppUser
 *
 * Better Auth HTTP handler: lib/better-auth (`auth`).
 */
import "server-only"
import { cache } from "react"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { defaultIdentityPorts } from "@/lib/identity/default-ports"
import {
  requireOwner as requireOwnerWithPorts,
  resolveAppUser as resolveAppUserWithPorts,
} from "@/lib/identity/resolve"
import type { AppGate, SessionUser } from "@/lib/identity"
import {
  OWNER_FORBIDDEN_MESSAGE,
  UNAUTHORIZED_MESSAGE,
} from "@/lib/auth-messages"

/**
 * One gate evaluation per React request (layout + page + metadata share this).
 * Read-only — never claims.
 */
export const getRequestGate = cache(async (): Promise<AppGate> => {
  return resolveAppUserWithPorts(defaultIdentityPorts, await headers())
})

/** Latest chat path for the signed-in owner, or draft if none exist. */
export async function workspaceHomePath(userId: string) {
  const chat = await db
    .selectFrom("chats")
    .select("id")
    .where("user_id", "=", userId)
    .orderBy("updated_at", "desc")
    .executeTakeFirst()
  return chat ? `/chat/${chat.id}` : "/chat/new"
}

/**
 * Workspace RSC gate: redirect until the caller is the instance owner.
 */
export async function requireWorkspaceUser(): Promise<SessionUser> {
  const gate = await getRequestGate()
  if (gate.status === "setup") redirect("/setup")
  if (gate.status === "login") redirect("/login")
  if (gate.status === "wrong_account") redirect("/login")
  return gate.user
}

/** Uncached resolve (API / scripts). RSC prefers getRequestGate. */
export async function resolveAppUser(
  requestHeaders: Headers
): Promise<AppGate> {
  return resolveAppUserWithPorts(defaultIdentityPorts, requestHeaders)
}

/** API routes: owner or throw stable auth messages. Migrates once via resolve. */
export async function requireOwner(requestHeaders: Headers) {
  return requireOwnerWithPorts(defaultIdentityPorts, requestHeaders)
}

export type { AppGate, SessionUser }
export { OWNER_FORBIDDEN_MESSAGE, UNAUTHORIZED_MESSAGE }
