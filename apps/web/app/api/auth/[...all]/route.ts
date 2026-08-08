import { toNextJsHandler } from "better-auth/next-js"
import { auth } from "@/lib/auth"
import { migrate, db } from "@/lib/db"

export const runtime = "nodejs"
const handler = toNextJsHandler(auth)

const CLAIMED_MESSAGE = "This single-owner instance is already claimed."

export async function GET(request: Request) {
  await migrate()
  return handler.GET(request)
}

export async function POST(request: Request) {
  await migrate()
  const isSignup = new URL(request.url).pathname.endsWith("/sign-up/email")
  if (isSignup) {
    const instance = await db
      .selectFrom("instance")
      .select("owner_user_id")
      .where("id", "=", 1)
      .executeTakeFirst()
    if (instance?.owner_user_id)
      return Response.json({ message: CLAIMED_MESSAGE }, { status: 403 })
  }
  const response = await handler.POST(request)
  if (isSignup && response.ok) {
    const payload = (await response
      .clone()
      .json()
      .catch(() => null)) as { user?: { id?: string } } | null
    const userId = payload?.user?.id
    if (userId) {
      const claim = await db
        .updateTable("instance")
        .set({ owner_user_id: userId })
        .where("id", "=", 1)
        .where("owner_user_id", "is", null)
        .executeTakeFirst()
      const updated = Number(claim.numUpdatedRows ?? 0)
      if (updated === 0) {
        // Another signup won the claim race — drop orphaned account + session.
        await db.deleteFrom("user").where("id", "=", userId).execute()
        return Response.json({ message: CLAIMED_MESSAGE }, { status: 403 })
      }
    }
  }
  return response
}

export async function PATCH(request: Request) {
  await migrate()
  return handler.PATCH(request)
}
export async function PUT(request: Request) {
  await migrate()
  return handler.PUT(request)
}
export async function DELETE(request: Request) {
  await migrate()
  return handler.DELETE(request)
}
