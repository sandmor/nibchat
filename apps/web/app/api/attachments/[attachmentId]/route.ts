import { requireUser } from "@/lib/app-session"
import {
  deletePendingAttachment,
  getAttachmentForOwner,
  headerSafeFilename,
  readAttachment,
  savePdfAnalysis,
} from "@/lib/attachments"
import { pdfAnalysisSchema } from "@/lib/pdf-analysis"
import { jsonError } from "@/lib/http-error"
import { startDiagnosticOperation } from "@/lib/diagnostics"

export const runtime = "nodejs"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  try {
    const user = await requireUser(request.headers)
    const { attachmentId } = await params
    const attachment = await getAttachmentForOwner(user.id, attachmentId)
    const data = await readAttachment(attachment)
    const body = new Uint8Array(data.byteLength)
    body.set(data)
    return new Response(body.buffer, {
      headers: {
        "content-type": attachment.media_type,
        "content-length": String(data.byteLength),
        "content-disposition": `inline; filename="${headerSafeFilename(attachment.filename)}"`,
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        etag: `"${attachment.sha256}"`,
      },
    })
  } catch (error) {
    return jsonError(error, "Attachment unavailable")
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  try {
    const user = await requireUser(request.headers)
    const { attachmentId } = await params
    await deletePendingAttachment(user.id, attachmentId)
    return Response.json({ ok: true })
  } catch (error) {
    return jsonError(error, "Attachment deletion failed")
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  let operation:
    | Awaited<ReturnType<typeof startDiagnosticOperation>>
    | undefined
  try {
    const user = await requireUser(request.headers)
    const { attachmentId } = await params
    operation = await startDiagnosticOperation({
      kind: "attachment.analysis.save",
      context: { userId: user.id },
      metadata: { attachmentId },
    })
    const analysis = pdfAnalysisSchema.parse(await request.json())
    await savePdfAnalysis(user.id, attachmentId, analysis)
    await operation.finish("complete", {
      analysisStatus: analysis.status,
      ...(analysis.pageCount === undefined
        ? {}
        : { pageCount: analysis.pageCount }),
      ...(analysis.pdfType ? { pdfType: analysis.pdfType } : {}),
    })
    return Response.json({ ok: true })
  } catch (error) {
    if (operation) await operation.finish("error", { phase: "request" }, error)
    return jsonError(error, "PDF analysis could not be saved")
  }
}
