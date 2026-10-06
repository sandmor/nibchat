import { requireUser } from "@/lib/app-session"
import { createUploadedFile } from "@/lib/attachments"
import { jsonError } from "@/lib/http-error"
import { startDiagnosticOperation } from "@/lib/diagnostics"

export const runtime = "nodejs"

export async function POST(request: Request) {
  let operation:
    | Awaited<ReturnType<typeof startDiagnosticOperation>>
    | undefined
  try {
    const user = await requireUser(request.headers)
    operation = await startDiagnosticOperation({
      kind: "attachment.upload",
      context: { userId: user.id },
    })
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File)) {
      await operation.finish("error", {
        reason: "file_missing",
        httpStatus: 400,
      })
      return Response.json({ error: "File is required" }, { status: 400 })
    }
    const attachment = await createUploadedFile(user.id, file)
    await operation.finish("complete", {
      attachmentId: attachment.id,
      byteCount: attachment.byte_size,
    })
    return Response.json({
      id: attachment.id,
      filename: attachment.filename,
      mediaType: attachment.media_type,
      byteSize: attachment.byte_size,
      sha256: attachment.sha256,
    })
  } catch (error) {
    if (operation) await operation.finish("error", { phase: "request" }, error)
    return jsonError(error, "File upload failed")
  }
}
