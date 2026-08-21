import { requireUser } from "@/lib/app-session"
import { createUploadedImage } from "@/lib/attachments"
import { jsonError } from "@/lib/http-error"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const user = await requireUser(request.headers)
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File))
      return Response.json({ error: "Image file is required" }, { status: 400 })
    const attachment = await createUploadedImage(user.id, file)
    return Response.json({
      id: attachment.id,
      filename: attachment.filename,
      mediaType: attachment.media_type,
      byteSize: attachment.byte_size,
    })
  } catch (error) {
    return jsonError(error, "Image upload failed")
  }
}
