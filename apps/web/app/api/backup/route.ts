import { requireOwner } from "@/lib/app-session"
import { createBackup } from "@/lib/chat-service"
import { jsonError } from "@/lib/http-error"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const user = await requireOwner(request.headers)
    const backup = await createBackup(user.id)
    return Response.json(backup, {
      headers: {
        "content-disposition": "attachment; filename=vero-backup.json",
      },
    })
  } catch (error) {
    return jsonError(error, "Backup failed")
  }
}
