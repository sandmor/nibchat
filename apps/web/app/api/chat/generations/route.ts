import { ZodError } from "zod"
import { requireUser } from "@/lib/app-session"
import {
  actionMatchesRequest,
  getGenerationAction,
  generationActionRequestHash,
  pruneGenerationActions,
} from "@/lib/generation-actions"
import { generationActionSseResponse } from "@/lib/generation-actions-stream"
import { generationStartSchema } from "@/lib/generation-start"
import { startGenerationAction } from "@/lib/generation-actions/start"
import { jsonError, statusFromError } from "@/lib/http-error"
import { formatProviderError } from "@/lib/provider-errors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  let retry: {
    actionId: string
    userId: string
    chatId: string
    requestHash: string
  } | null = null
  try {
    const user = await requireUser(request.headers)
    await pruneGenerationActions()
    let body: ReturnType<typeof generationStartSchema.parse>
    try {
      body = generationStartSchema.parse(await request.json())
    } catch (error) {
      if (error instanceof ZodError) {
        return Response.json(
          { error: error.issues[0]?.message ?? "Invalid generation request" },
          { status: 400 }
        )
      }
      throw error
    }
    const requestHash = generationActionRequestHash(body)
    retry = {
      actionId: body.actionId,
      userId: user.id,
      chatId: body.chatId,
      requestHash,
    }
    const existing = await getGenerationAction(body.actionId, user.id)
    if (existing) {
      if (!actionMatchesRequest(existing, retry))
        return Response.json(
          { error: "Action ID already used for another request" },
          { status: 409 }
        )
      return generationActionSseResponse(existing, null)
    }
    return await startGenerationAction({ user, body, requestHash })
  } catch (error) {
    if (retry) {
      const existing = await getGenerationAction(retry.actionId, retry.userId)
      if (existing) {
        if (!actionMatchesRequest(existing, retry))
          return Response.json(
            { error: "Action ID already used for another request" },
            { status: 409 }
          )
        return generationActionSseResponse(existing, null)
      }
    }
    console.error("[nibchat/generation-start] setup", error)
    if (statusFromError(error) !== 400) return jsonError(error)
    return Response.json({ error: formatProviderError(error) }, { status: 400 })
  }
}
