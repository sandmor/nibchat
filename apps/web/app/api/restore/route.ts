import { requireOwner } from "@/lib/app-session"
import { restoreBackup, restoreBackupArchive } from "@/lib/chat-service"
import { looksLikeZip } from "@/lib/file-signatures"
import { jsonError } from "@/lib/http-error"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const user = await requireOwner(request.headers)
    const bytes = new Uint8Array(await request.arrayBuffer())
    if (looksLikeZip(bytes)) await restoreBackupArchive(user.id, bytes)
    else {
      const text = new TextDecoder().decode(bytes)
      await restoreBackup(user.id, JSON.parse(text) as unknown)
    }
    return Response.json({ ok: true })
  } catch (error) {
    return jsonError(error, "Restore failed")
  }
}
