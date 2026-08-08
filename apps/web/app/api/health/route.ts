import { db } from "@/lib/db"

export const runtime = "nodejs"

/**
 * Unauthenticated probe. Only reads a known row; does not run migrations.
 * Returns 503 if the database is missing or not yet initialized.
 */
export async function GET() {
  try {
    await db
      .selectFrom("instance")
      .select("id")
      .where("id", "=", 1)
      .executeTakeFirstOrThrow()
    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: false }, { status: 503 })
  }
}
