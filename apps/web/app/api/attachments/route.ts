import { requireUser } from "@/lib/app-session"
import { createUploadedFile } from "@/lib/attachments"
import { jsonError } from "@/lib/http-error"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const user = await requireUser(request.headers)
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File))
      return Response.json({ error: "File is required" }, { status: 400 })
    const attachment = await createUploadedFile(user.id, file)
    return Response.json({
      id: attachment.id,
      filename: attachment.filename,
      mediaType: attachment.media_type,
      byteSize: attachment.byte_size,
    })
  } catch (error) {
    return jsonError(error, "File upload failed")
  }
}
