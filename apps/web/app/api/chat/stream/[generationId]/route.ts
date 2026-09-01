import { requireUser } from "@/lib/app-session"
import { db } from "@/lib/db"
import { generationStreamStore } from "@/lib/generation-streams/default-port"
import { generationSseResponse } from "@/lib/generation-streams/http"
import {
  GENERATION_ATTACH_POLL_MS,
  GENERATION_ATTACH_WAIT_MS,
  decideGenerationAttach,
  type GenerationRunState,
} from "@/lib/generation-streams/policy"
import { requestGenerationCancellation } from "@/lib/generation-runs"
import { abortGenerations } from "@/lib/active-generations"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function ownedRun(generationId: string, userId: string) {
  return db
    .selectFrom("generation_runs")
    .innerJoin("chats", "chats.id", "generation_runs.chat_id")
    .select([
      "generation_runs.id",
      "generation_runs.node_id",
      "generation_runs.state",
      "generation_runs.started_at",
    ])
    .where("generation_runs.id", "=", generationId)
    .where("chats.user_id", "=", userId)
    .executeTakeFirst()
}

async function ownsChat(chatId: string, userId: string) {
  return db
    .selectFrom("chats")
    .select("id")
    .where("id", "=", chatId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function GET(
  request: Request,
  context: { params: Promise<{ generationId: string }> }
) {
  const user = await requireUser(request.headers)
  const { generationId } = await context.params
  const rawCursor = new URL(request.url).searchParams.get("cursor")
  if (rawCursor != null && !rawCursor.trim())
    return Response.json({ error: "Invalid stream cursor" }, { status: 400 })

  const deadline = Date.now() + GENERATION_ATTACH_WAIT_MS
  for (;;) {
    const run = await ownedRun(generationId, user.id)

    let snapshot
    try {
      snapshot = await generationStreamStore.inspect(generationId)
    } catch (error) {
      console.warn("[nibchat/generation-attach] store unavailable", error)
      if (Date.now() >= deadline)
        return new Response(null, {
          status: 425,
          headers: { "retry-after": "1" },
        })
      await pause(GENERATION_ATTACH_POLL_MS)
      continue
    }

    // Finalization removes the durable run before publishing the terminal
    // event. The store retains trusted stream metadata for a short drain
    // window, letting the message owner replay that last event.
    const streamOwner = snapshot.meta
      ? await ownsChat(snapshot.meta.chatId, user.id)
      : null
    if (!run && !streamOwner) return new Response(null, { status: 404 })

    const decision = decideGenerationAttach({
      run: run
        ? {
            state: run.state as GenerationRunState,
            startedAt: run.started_at,
          }
        : null,
      snapshot,
      replay: Boolean(streamOwner),
    })
    if (decision === "subscribe") {
      const response = generationSseResponse(
        generationStreamStore.subscribe(generationId, rawCursor, request.signal)
      )
      const headers = new Headers(response.headers)
      headers.set("X-Accel-Buffering", "no")
      headers.set("X-Nibchat-Generation-Id", generationId)
      return new Response(response.body, { status: response.status, headers })
    }
    if (decision === "gone") return new Response(null, { status: 404 })
    if (decision === "unavailable") return new Response(null, { status: 410 })
    if (Date.now() >= deadline)
      return new Response(null, {
        status: 425,
        headers: { "retry-after": "1" },
      })
    await pause(GENERATION_ATTACH_POLL_MS)
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ generationId: string }> }
) {
  const user = await requireUser(request.headers)
  const { generationId } = await context.params
  const run = await ownedRun(generationId, user.id)
  if (!run) return new Response(null, { status: 404 })
  await requestGenerationCancellation(generationId)
  await generationStreamStore
    .requestCancel(generationId)
    .catch((error) => console.error("[nibchat/generation-cancel]", error))
  abortGenerations([run.node_id])
  return new Response(null, { status: 202 })
}
