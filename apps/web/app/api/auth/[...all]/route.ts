import { toNextJsHandler } from "better-auth/next-js"
import { auth } from "@/lib/better-auth"
import { migrate, db } from "@/lib/db"
import { createKyselyInstanceOwnerPort } from "@/lib/identity/adapters/kysely-instance"

export const runtime = "nodejs"
const handler = toNextJsHandler(auth)
const instanceOwner = createKyselyInstanceOwnerPort()

const CLAIMED_MESSAGE = "This instance already has an owner."
const CLAIM_FAILED_MESSAGE =
  "Could not claim this instance. Try again or contact the operator."

type AuthPayload = { user?: { id?: string; email?: string } } | null

/** Prefer body user id; fall back to session cookies set by the response. */
async function resolveAuthUserId(
  request: Request,
  response: Response,
  payload: AuthPayload
): Promise<string | undefined> {
  if (payload?.user?.id) return payload.user.id

  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : []
  if (!setCookies.length) return undefined

  const forwarded = new Headers(request.headers)
  const existing = forwarded.get("cookie")
  const fromResponse = setCookies
    .map((entry) => entry.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ")
  forwarded.set("cookie", [existing, fromResponse].filter(Boolean).join("; "))
  const session = await auth.api.getSession({ headers: forwarded })
  return session?.user?.id
}

async function deleteUserById(userId: string) {
  try {
    await db.deleteFrom("user").where("id", "=", userId).execute()
  } catch {
    /* cascade failures are rare; claim path still fails closed */
  }
}

async function deleteUserByEmail(email: string) {
  try {
    await db.deleteFrom("user").where("email", "=", email).execute()
  } catch {
    /* ignore */
  }
}

async function promoteOwner(userId: string) {
  try {
    await db
      .updateTable("user")
      .set({ role: "admin" })
      .where("id", "=", userId)
      .execute()
  } catch {
    /* Older schemas are upgraded by the next migration pass. */
  }
}

/**
 * CAS claim for signup/sign-in only (never on reads).
 * @returns error Response, or null when ownership is ok for this user.
 */
async function claimAfterAuth(
  userId: string,
  options: { deleteUserOnFailure: boolean }
): Promise<Response | null> {
  let ownerId = await instanceOwner.getOwnerUserId()
  if (ownerId === userId) {
    await promoteOwner(userId)
    return null
  }
  if (ownerId && ownerId !== userId) return null

  const claimed = await instanceOwner.tryClaimOwner(userId)
  if (claimed) {
    await promoteOwner(userId)
    return null
  }

  ownerId = await instanceOwner.getOwnerUserId()
  if (ownerId === userId) {
    await promoteOwner(userId)
    return null
  }
  if (ownerId && ownerId !== userId) return null
  if (options.deleteUserOnFailure) await deleteUserById(userId)
  // Owner still null after failed CAS — never leave a half-success session.
  return Response.json({ message: CLAIM_FAILED_MESSAGE }, { status: 500 })
}

export async function GET(request: Request) {
  await migrate()
  if (new URL(request.url).pathname.includes("/admin/"))
    return Response.json({ message: "Not found" }, { status: 404 })
  return handler.GET(request)
}

export async function POST(request: Request) {
  await migrate()
  const path = new URL(request.url).pathname
  if (path.includes("/admin/"))
    return Response.json({ message: "Not found" }, { status: 404 })
  const isSignup = path.endsWith("/sign-up/email")
  const isSignIn = path.endsWith("/sign-in/email")

  let signupEmail: string | undefined
  if (isSignup) {
    const ownerId = await instanceOwner.getOwnerUserId()
    if (ownerId)
      return Response.json({ message: CLAIMED_MESSAGE }, { status: 403 })
    const preBody = (await request
      .clone()
      .json()
      .catch(() => null)) as { email?: string } | null
    signupEmail = typeof preBody?.email === "string" ? preBody.email : undefined
  }

  const response = await handler.POST(request)

  if ((isSignup || isSignIn) && response.ok) {
    const payload = (await response
      .clone()
      .json()
      .catch(() => null)) as AuthPayload
    const userId = await resolveAuthUserId(request, response, payload)

    if (!userId) {
      if (isSignup) {
        if (signupEmail) await deleteUserByEmail(signupEmail)
        return Response.json({ message: CLAIM_FAILED_MESSAGE }, { status: 500 })
      }
      // Sign-in without resolvable user — fail closed rather than ambiguous setup.
      return Response.json({ message: CLAIM_FAILED_MESSAGE }, { status: 500 })
    }

    const claimError = await claimAfterAuth(userId, {
      deleteUserOnFailure: isSignup,
    })
    if (claimError) return claimError
  }

  return response
}

export async function PATCH(request: Request) {
  await migrate()
  if (new URL(request.url).pathname.includes("/admin/"))
    return Response.json({ message: "Not found" }, { status: 404 })
  return handler.PATCH(request)
}
export async function PUT(request: Request) {
  await migrate()
  if (new URL(request.url).pathname.includes("/admin/"))
    return Response.json({ message: "Not found" }, { status: 404 })
  return handler.PUT(request)
}
export async function DELETE(request: Request) {
  await migrate()
  if (new URL(request.url).pathname.includes("/admin/"))
    return Response.json({ message: "Not found" }, { status: 404 })
  return handler.DELETE(request)
}
