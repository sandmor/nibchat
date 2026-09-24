import { requireUser } from "@/lib/app-session"
import {
  getGenerationAction,
  pruneGenerationActions,
} from "@/lib/generation-actions"
import { generationActionSseResponse } from "@/lib/generation-actions-stream"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  context: { params: Promise<{ actionId: string }> }
) {
  const user = await requireUser(request.headers)
  await pruneGenerationActions()
  const { actionId } = await context.params
  const action = await getGenerationAction(actionId, user.id)
  if (!action)
    return Response.json({ error: "Action not found" }, { status: 404 })
  try {
    return generationActionSseResponse(
      action,
      new URL(request.url).searchParams.get("cursor")
    )
  } catch {
    return Response.json({ error: "Invalid action cursor" }, { status: 400 })
  }
}
