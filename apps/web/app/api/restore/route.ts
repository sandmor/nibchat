import { requireOwner } from "@/lib/app-session"
import { restoreBackup, restoreBackupArchive } from "@/lib/chat-service"
import { looksLikeZip } from "@/lib/file-signatures"
import { jsonError } from "@/lib/http-error"
import { startDiagnosticOperation } from "@/lib/diagnostics"

export const runtime = "nodejs"

export async function POST(request: Request) {
  let operation:
    | Awaited<ReturnType<typeof startDiagnosticOperation>>
    | undefined
  try {
    const user = await requireOwner(request.headers)
    operation = await startDiagnosticOperation({
      kind: "backup.restore",
      context: { userId: user.id },
    })
    const bytes = new Uint8Array(await request.arrayBuffer())
    if (looksLikeZip(bytes)) await restoreBackupArchive(user.id, bytes)
    else {
      const text = new TextDecoder().decode(bytes)
      await restoreBackup(user.id, JSON.parse(text) as unknown)
    }
    await operation.finish("complete", { byteCount: bytes.byteLength })
    return Response.json({ ok: true })
  } catch (error) {
    if (operation) await operation.finish("error", { phase: "request" }, error)
    return jsonError(error, "Restore failed")
  }
}
