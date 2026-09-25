import "server-only"
import { db, fromDbBool } from "@/lib/db"
import { generationStreamStore } from "@/lib/generation-streams/default-port"
import {
  GENERATION_ATTACH_POLL_MS,
  GENERATION_STARTING_HANDOFF_MS,
} from "@/lib/generation-streams/policy"
import { reconcileChatGenerationRuns } from "@/lib/chat-service"
import type { GenerationTerminalResult } from "@/lib/generation-streams/events"
import type { NodeRow } from "@/lib/types"
import { MAX_HEADER_VALUE_CHARS, MAX_ID } from "@/lib/limits"
import type { getGenerationAction } from "@/lib/generation-actions"
import type { ActionStreamEvent } from "@/lib/generation-start"

type Action = NonNullable<Awaited<ReturnType<typeof getGenerationAction>>>
const encoder = new TextEncoder()
const TERMINAL_CURSOR = "!"

function encodeCursor(cursors: Record<string, string>) {
  return Buffer.from(JSON.stringify(cursors)).toString("base64url")
}

function decodeCursor(raw: string | null, action: Action) {
  if (!raw) return {} as Record<string, string>
  if (raw.length > MAX_HEADER_VALUE_CHARS)
    throw new Error("Invalid action cursor")
  const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString())
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid action cursor")
  const allowed = new Set(action.generations.map((item) => item.generationId))
  const cursors: Record<string, string> = {}
  for (const [id, value] of Object.entries(parsed)) {
    if (!allowed.has(id) || typeof value !== "string" || value.length > MAX_ID)
      throw new Error("Invalid action cursor")
    cursors[id] = value
  }
  return cursors
}

async function durableTerminal(item: Action["generations"][number]) {
  const node = await db
    .selectFrom("message_nodes")
    .selectAll()
    .where("id", "=", item.assistantNodeId)
    .executeTakeFirst()
  if (!node) return { type: "terminal", result: "deleted", node: null } as const
  const result: GenerationTerminalResult =
    node.status === "complete" || node.status === "awaiting_input"
      ? node.status
      : node.status === "stopped"
        ? "stopped"
        : "error"
  return {
    type: "terminal",
    result,
    node: {
      ...node,
      excluded_from_context: fromDbBool(node.excluded_from_context),
    } as NodeRow,
  } as const
}

/** A cursor vector replays interleaved siblings; closing this reader leaves producers running. */
export function generationActionSseResponse(
  action: Action,
  rawCursor: string | null
) {
  const cursors = decodeCursor(rawCursor, action)
  const signal = new AbortController()
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: ActionStreamEvent) => {
        if (closed) return
        controller.enqueue(
          encoder.encode(
            `id: ${encodeCursor(cursors)}\ndata: ${JSON.stringify(event)}\n\n`
          )
        )
      }
      emit({
        type: "action-started",
        actionId: action.actionId,
        chatId: action.chatId,
        userNodeId: action.userNodeId,
        selectedNodeId: action.selectedNodeId,
        generations: action.generations.map((item) => ({
          generationId: item.generationId,
          assistantNodeId: item.assistantNodeId,
          parentNodeId: item.parentNodeId,
        })),
      })
      const mirror = async (item: Action["generations"][number]) => {
        const id = item.generationId
        if (cursors[id] === TERMINAL_CURSOR) return
        while (!signal.signal.aborted) {
          try {
            const snapshot = await generationStreamStore.inspect(id)
            if (snapshot.state === "open" || snapshot.state === "closed") {
              let sawTerminal = false
              for await (const {
                cursor,
                payload,
              } of generationStreamStore.subscribe(
                id,
                cursors[id] ?? null,
                signal.signal
              )) {
                cursors[id] =
                  payload.type === "terminal" ? TERMINAL_CURSOR : cursor
                emit({
                  type: "generation-event",
                  generationId: id,
                  event: payload,
                })
                if (payload.type === "terminal") {
                  sawTerminal = true
                  break
                }
              }
              if (signal.signal.aborted || sawTerminal) return
            }
            const run = await db
              .selectFrom("generation_runs")
              .select(["id", "started_at", "state"])
              .where("id", "=", id)
              .executeTakeFirst()
            if (!run) {
              cursors[id] = TERMINAL_CURSOR
              emit({
                type: "generation-event",
                generationId: id,
                event: await durableTerminal(item),
              })
              return
            }
            if (
              run.state !== "starting" ||
              Date.now() - Date.parse(run.started_at) >
                GENERATION_STARTING_HANDOFF_MS
            )
              await reconcileChatGenerationRuns(action.chatId)
          } catch (error) {
            if (!signal.signal.aborted)
              console.warn("[nibchat/action-stream] retry", error)
          }
          await new Promise<void>((resolve) =>
            setTimeout(resolve, GENERATION_ATTACH_POLL_MS)
          )
        }
      }
      void Promise.allSettled(action.generations.map(mirror)).then(() => {
        if (closed) return
        emit({ type: "action-finished", actionId: action.actionId })
        closed = true
        controller.close()
      })
    },
    cancel() {
      closed = true
      signal.abort()
    },
  })
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  })
}
