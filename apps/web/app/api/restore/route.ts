import { requireOwner } from "@/lib/app-session"
import { restoreBackup } from "@/lib/chat-service"
import { jsonError } from "@/lib/http-error"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const user = await requireOwner(request.headers)
    const body = await request.json()
    await restoreBackup(user.id, body)
    return Response.json({ ok: true })
  } catch (error) {
    return jsonError(error, "Restore failed")
  }
}
