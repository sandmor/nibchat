import { requireUser } from "@/lib/app-session"
import { queueAgentMessage, stopAgentRun } from "@/lib/agent/task-controls"

export const runtime = "nodejs"

export async function DELETE(
  request: Request,
  context: { params: Promise<{ chatId: string }> }
) {
  const user = await requireUser(request.headers)
  const { chatId } = await context.params
  try {
    return Response.json(await stopAgentRun(user.id, chatId))
  } catch (error) {
    if (error instanceof Error && error.message === "Helper not found")
      return Response.json({ error: error.message }, { status: 404 })
    throw error
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ chatId: string }> }
) {
  const user = await requireUser(request.headers)
  const { chatId } = await context.params
  const body = (await request.json().catch(() => ({}))) as { content?: unknown }
  if (typeof body.content !== "string")
    return Response.json({ error: "Message is required" }, { status: 400 })
  try {
    return Response.json(await queueAgentMessage(user.id, chatId, body.content))
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send message"
    return Response.json(
      { error: message },
      { status: message === "Helper not found" ? 404 : 400 }
    )
  }
}
