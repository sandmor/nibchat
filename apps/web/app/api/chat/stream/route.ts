import {
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type ModelMessage,
} from "ai"
import { ZodError } from "zod"
import { db } from "@/lib/db"
import { requireOwner } from "@/lib/app-session"
import { ancestorPath, parseJson } from "@/lib/domain"
import {
  createTurn,
  nodeParts,
  startGenerate,
  startRegenerate,
  updateNode,
} from "@/lib/chat-service"
import { canReplayReasoning, modelFor, type ModelConfig } from "@/lib/providers"
import { formatProviderError } from "@/lib/provider-errors"
import { jsonError, statusFromError } from "@/lib/http-error"
import { streamBodySchema } from "@/lib/stream-body"
import type { NodeRow } from "@/lib/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function streamMeta(config: ModelConfig) {
  return {
    provider: config.providerId,
    model: config.model,
    startedAt: new Date().toISOString(),
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireOwner(request.headers)
    let body: ReturnType<typeof streamBodySchema.parse>
    try {
      body = streamBodySchema.parse(await request.json())
    } catch (error) {
      if (error instanceof ZodError) {
        return Response.json(
          { error: error.issues[0]?.message ?? "Invalid stream body" },
          { status: 400 }
        )
      }
      throw error
    }
    const chat = await db
      .selectFrom("chats")
      .selectAll()
      .where("id", "=", body.chatId)
      .where("user_id", "=", user.id)
      .executeTakeFirst()
    if (!chat)
      return Response.json({ error: "Chat not found" }, { status: 404 })
    const config = parseJson<ModelConfig>(chat.model_config_json, {})
    const languageModel = await modelFor(user.id, config)
    const assistantMeta = streamMeta(config)

    let assistant: NodeRow
    let contextLeafId: string | null

    if (body.intent === "continue") {
      const message = body.content.trim()
      if (!message)
        return Response.json({ error: "Message is required" }, { status: 400 })
      const parentId = body.parentNodeId ?? null
      const turn = await createTurn({
        chatId: chat.id,
        parentId,
        content: message,
        assistantMetadata: assistantMeta,
      })
      assistant = turn.assistant
      contextLeafId = turn.user.id
      if (chat.title === "New conversation")
        await db
          .updateTable("chats")
          .set({
            title: message.slice(0, 72),
            updated_at: new Date().toISOString(),
          })
          .where("id", "=", chat.id)
          .execute()
    } else if (body.intent === "regenerate") {
      const result = await startRegenerate(
        user.id,
        body.assistantNodeId,
        assistantMeta
      )
      assistant = result.assistant
      contextLeafId = result.contextLeafId
    } else {
      const result = await startGenerate(
        user.id,
        body.parentNodeId,
        assistantMeta
      )
      assistant = result.assistant
      contextLeafId = result.contextLeafId
    }

    const allNodes = await db
      .selectFrom("message_nodes")
      .selectAll()
      .where("chat_id", "=", chat.id)
      .orderBy("created_at")
      .execute()
    const contextNodes = contextLeafId
      ? ancestorPath(allNodes, contextLeafId)
      : []
    const replayReasoning = await canReplayReasoning(user.id, config)
    const messages: ModelMessage[] = contextNodes
      .filter((node) => node.status !== "error" || node.search_text)
      .map((node) => {
        const metadata = parseJson<Record<string, unknown>>(
          node.metadata_json,
          {}
        )
        const parts = nodeParts(node).filter(
          (part) =>
            part.type === "text" ||
            (replayReasoning &&
              part.type === "reasoning" &&
              node.role === "assistant" &&
              metadata.provenance !== "owner-edited")
        )
        if (node.role === "assistant")
          return {
            role: "assistant" as const,
            content: parts.map((part) =>
              part.type === "reasoning"
                ? { type: "reasoning" as const, text: part.text }
                : { type: "text" as const, text: part.text }
            ),
          }
        if (node.role === "system")
          return {
            role: "system" as const,
            content: parts.map((part) => part.text).join("\n"),
          }
        return {
          role: "user" as const,
          content: parts.map((part) => ({
            type: "text" as const,
            text: part.text,
          })),
        }
      })
    let finalText = ""
    let partialText = ""
    let partialReasoning = ""
    const instance = await db
      .selectFrom("instance")
      .select("system_prompt")
      .where("id", "=", 1)
      .executeTakeFirstOrThrow()
    const result = streamText({
      model: languageModel,
      system: instance.system_prompt,
      messages,
      abortSignal: request.signal,
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      topP: config.topP,
      frequencyPenalty: config.frequencyPenalty,
      presencePenalty: config.presencePenalty,
      stopSequences: config.stopSequences,
      providerOptions: config.providerOptions as never,
      onChunk: ({ chunk }) => {
        if (chunk.type === "text-delta") partialText += chunk.text
        if (chunk.type === "reasoning-delta") partialReasoning += chunk.text
      },
      onFinish: async ({ text, reasoningText, usage, finishReason }) => {
        finalText = text
        await updateNode(
          assistant.id,
          [
            ...(reasoningText || partialReasoning
              ? [
                  {
                    type: "reasoning" as const,
                    text: reasoningText || partialReasoning,
                  },
                ]
              : []),
            { type: "text", text },
          ],
          "complete"
        )
        await db
          .updateTable("message_nodes")
          .set({
            metadata_json: JSON.stringify({
              provider: config.providerId,
              model: config.model,
              finishedAt: new Date().toISOString(),
              finishReason,
              usage,
              params: config,
            }),
            updated_at: new Date().toISOString(),
          })
          .where("id", "=", assistant.id)
          .execute()
      },
      onAbort: async () => {
        await updateNode(
          assistant.id,
          [
            ...(partialReasoning
              ? [{ type: "reasoning" as const, text: partialReasoning }]
              : []),
            ...(partialText
              ? [{ type: "text" as const, text: partialText }]
              : []),
          ],
          "stopped"
        )
      },
      onError: async ({ error }) => {
        console.error("[vero/stream]", error)
        if (finalText) return
        const errorText = formatProviderError(error)
        await updateNode(
          assistant.id,
          [
            ...(partialReasoning
              ? [{ type: "reasoning" as const, text: partialReasoning }]
              : []),
            ...(partialText
              ? [{ type: "text" as const, text: partialText }]
              : []),
          ],
          "error"
        )
        const previous = parseJson<Record<string, unknown>>(
          assistant.metadata_json,
          {}
        )
        await db
          .updateTable("message_nodes")
          .set({
            metadata_json: JSON.stringify({
              ...previous,
              provider: config.providerId,
              model: config.model,
              error: errorText,
              errorAt: new Date().toISOString(),
            }),
            updated_at: new Date().toISOString(),
          })
          .where("id", "=", assistant.id)
          .execute()
      },
    })
    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        sendReasoning: true,
        onError: formatProviderError,
      }),
      headers: {
        "X-Vero-Assistant-Node": assistant.id,
        ...(body.intent === "continue" && contextLeafId
          ? { "X-Vero-User-Node": contextLeafId }
          : {}),
        "X-Accel-Buffering": "no",
      },
    })
  } catch (error) {
    console.error("[vero/stream] setup", error)
    if (statusFromError(error) !== 400) return jsonError(error)
    return Response.json({ error: formatProviderError(error) }, { status: 400 })
  }
}
