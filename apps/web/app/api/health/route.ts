import { db } from "@/lib/db"

export const runtime = "nodejs"

/**
 * Unauthenticated readiness probe. Checks database connectivity without
 * requiring a schema or running migrations.
 */
export async function GET() {
  try {
    await db
      .selectNoFrom((eb) => eb.val(1).as("reachable"))
      .executeTakeFirstOrThrow()
    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: false }, { status: 503 })
  }
}
