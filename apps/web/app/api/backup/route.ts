import { requireOwner } from "@/lib/app-session"
import { createBackupArchive } from "@/lib/chat-service"
import { jsonError } from "@/lib/http-error"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const user = await requireOwner(request.headers)
    const zip = await createBackupArchive(user.id)
    const body = new Uint8Array(zip.byteLength)
    body.set(zip)
    return new Response(body.buffer, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": "attachment; filename=nibchat-backup.zip",
      },
    })
  } catch (error) {
    return jsonError(error, "Backup failed")
  }
}
