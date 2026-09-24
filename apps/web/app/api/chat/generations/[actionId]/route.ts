import { requireUser } from "@/lib/app-session"
import {
  getGenerationAction,
  pruneGenerationActions,
} from "@/lib/generation-actions"
import { reconcileChatGenerationRuns } from "@/lib/chat-service"

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
  await reconcileChatGenerationRuns(action.chatId)
  const current = await getGenerationAction(actionId, user.id)
  if (!current)
    return Response.json({ error: "Action not found" }, { status: 404 })
  return Response.json({
    actionId: current.actionId,
    chatId: current.chatId,
    intent: current.intent,
    userNodeId: current.userNodeId,
    generations: current.generations,
  })
}
