import { requireOwner } from "@/lib/app-session"
import { createBackupArchive } from "@/lib/chat-service"
import { jsonError } from "@/lib/http-error"
import { startDiagnosticOperation } from "@/lib/diagnostics"

export const runtime = "nodejs"

export async function GET(request: Request) {
  let operation:
    | Awaited<ReturnType<typeof startDiagnosticOperation>>
    | undefined
  try {
    const user = await requireOwner(request.headers)
    operation = await startDiagnosticOperation({
      kind: "backup.export",
      context: { userId: user.id },
    })
    const zip = await createBackupArchive()
    await operation.finish("complete", { byteCount: zip.byteLength })
    const body = new Uint8Array(zip.byteLength)
    body.set(zip)
    return new Response(body.buffer, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": "attachment; filename=nibchat-backup.zip",
      },
    })
  } catch (error) {
    if (operation) await operation.finish("error", { phase: "request" }, error)
    return jsonError(error, "Backup failed")
  }
}
