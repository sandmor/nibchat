import { z } from "zod"
import { statusFromError, jsonError } from "@/lib/http-error"
import { requireUser } from "@/lib/app-session"
import { db } from "@/lib/db"
import {
  listDiagnosticOperations,
  logDiagnosticFailure,
} from "@/lib/diagnostics"
import { MAX_COLLECTION, MAX_ID } from "@/lib/limits"
import {
  DIAGNOSTIC_OUTCOMES,
  DIAGNOSTIC_KINDS,
  DIAGNOSTIC_LEVELS,
} from "@/lib/diagnostic-contract"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

async function access(request: Request) {
  const user = await requireUser(request.headers)
  const instance = await db
    .selectFrom("instance")
    .select("owner_user_id")
    .where("id", "=", 1)
    .executeTakeFirst()
  return { userId: user.id, isOwner: instance?.owner_user_id === user.id }
}

const filters = z.object({
  kind: z.enum(DIAGNOSTIC_KINDS).optional(),
  outcome: z.enum(DIAGNOSTIC_OUTCOMES).optional(),
  chatId: z.string().max(MAX_ID).optional(),
  cursor: z.string().max(MAX_ID).optional(),
  since: z.iso.datetime().optional(),
  level: z.enum(DIAGNOSTIC_LEVELS).optional(),
})

function inputFor(request: Request, scope: Awaited<ReturnType<typeof access>>) {
  const url = new URL(request.url)
  return {
    userId: scope.isOwner ? "*" : scope.userId,
    isOwner: scope.isOwner,
    ...filters.parse(
      Object.fromEntries(
        ["kind", "outcome", "chatId", "cursor", "since", "level"].flatMap(
          (key) => {
            const value = url.searchParams.get(key)
            return value ? [[key, value]] : []
          }
        )
      )
    ),
    limit: MAX_COLLECTION,
  }
}

export async function GET(request: Request) {
  try {
    return await activityResponse(request)
  } catch (error) {
    if (statusFromError(error) === 401 || statusFromError(error) === 403)
      return jsonError(error)
    if (error instanceof z.ZodError)
      return Response.json(
        { error: "Invalid activity filters" },
        { status: 400 }
      )
    logDiagnosticFailure("activity.request_failed", error)
    return Response.json({ error: "Unable to load activity" }, { status: 500 })
  }
}

async function activityResponse(request: Request) {
  const scope = await access(request)
  const input = inputFor(request, scope)
  if (new URL(request.url).searchParams.get("stream") !== "1")
    return Response.json(await listDiagnosticOperations(input), {
      headers: { "Cache-Control": "no-store" },
    })

  if (process.env.GENERATION_RUNTIME_MODE === "stateless")
    return Response.json(
      { error: "Activity streams are unavailable in stateless mode." },
      { status: 409 }
    )

  const encoder = new TextEncoder()
  let stopStream = () => {}
  let poll = async () => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let previous = ""
      let timer: ReturnType<typeof setTimeout> | undefined
      let wake: (() => void) | undefined
      const deadline = setTimeout(() => stop(), maxDuration * 1000)
      const send = (event: string, data: unknown) => {
        if (!closed)
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          )
      }
      const stop = () => {
        if (closed) return
        closed = true
        clearTimeout(deadline)
        clearTimeout(timer)
        wake?.()
        request.signal.removeEventListener("abort", stop)
        try {
          controller.close()
        } catch {
          // The response body may already have been cancelled by its reader.
        }
      }
      stopStream = stop
      request.signal.addEventListener("abort", stop, { once: true })
      if (request.signal.aborted) stop()

      // Poll only when the response reader has room for another snapshot.
      // A loop in start() ignores backpressure and can buffer large histories
      // for slow or disconnected clients.
      poll = async () => {
        if (closed) return
        try {
          const snapshot = await listDiagnosticOperations(input)
          if (closed) return
          const serialized = JSON.stringify(snapshot)
          if (serialized !== previous) {
            previous = serialized
            send("activity", snapshot)
          } else send("keepalive", { at: new Date().toISOString() })
        } catch (error) {
          logDiagnosticFailure(
            "activity.stream_snapshot_failed",
            error,
            "warn",
            {
              userId: scope.userId,
            }
          )
          send("activity-error", { retry: true })
        }
        if (closed) return
        await new Promise<void>((resolve) => {
          wake = resolve
          timer = setTimeout(resolve, 2_000)
        })
        timer = undefined
        wake = undefined
      }
    },
    pull() {
      return poll()
    },
    cancel() {
      stopStream()
    },
  })
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
