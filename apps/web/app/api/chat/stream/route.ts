import { ZodError } from "zod"
import {
  createGenerationResponse,
  ResumeClaimError,
} from "@/lib/agent/run-generation"
import {
  applyToolOutputs,
  pendingToolInvocations,
  textFromParts,
} from "@/lib/agent/parts"
import {
  answersFromResumeOutput,
  formatQuestionResult,
  validateQuestionAnswers,
} from "@/lib/agent/tools"
import { requireUser } from "@/lib/app-session"
import {
  createTurn,
  getTitleModelConfig,
  maybeAssignChatTitle,
  nodeParts,
  resolveStackForChat,
  startGenerate,
  startRegenerate,
} from "@/lib/chat-service"
import { db } from "@/lib/db"
import { parseJson } from "@/lib/domain"
import { jsonError, statusFromError } from "@/lib/http-error"
import { formatProviderError } from "@/lib/provider-errors"
import { modelFor, resolveModelConfig, type ModelConfig } from "@/lib/providers"
import { resolveMcpResourceAttachment } from "@/lib/mcp"
import { resolveUploadedAttachments } from "@/lib/attachments"
import { streamBodySchema } from "@/lib/stream-body"
import { firstTurnTitleAction } from "@/lib/chat-title"
import type { AttachmentReference, NodeRow, Parts } from "@/lib/types"

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
    const user = await requireUser(request.headers)
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
    const savedConfig = parseJson<ModelConfig>(chat.model_config_json, {})
    const config = await resolveModelConfig(user.id, savedConfig)
    if (JSON.stringify(config) !== JSON.stringify(savedConfig))
      await db
        .updateTable("chats")
        .set({
          model_config_json: JSON.stringify(config),
          updated_at: new Date().toISOString(),
        })
        .where("id", "=", chat.id)
        .execute()
    const languageModel = await modelFor(user.id, config)
    const assistantMeta = streamMeta(config)

    let assistant: NodeRow
    let contextLeafId: string | null
    let seedParts: Parts = []
    let headers: Record<string, string> = {}
    let afterFinalize:
      | ((input: {
          outcome: "complete" | "awaiting_input" | "aborted" | "error"
          parts: Parts
        }) => Promise<void>)
      | undefined

    if (body.intent === "continue") {
      const message = body.content.trim()
      const references = uniqueAttachmentReferences(body.attachments ?? [])
      if (!message && references.length === 0)
        return Response.json({ error: "Message is required" }, { status: 400 })
      const mcpReferences = references.filter(
        (reference) => reference.kind === "mcp-resource"
      )
      const attachments = [
        ...(await Promise.all(
          mcpReferences.map((reference) =>
            resolveMcpResourceAttachment(reference)
          )
        )),
        ...(await resolveUploadedAttachments(user.id, references)),
      ]
      const parentId = body.parentNodeId ?? null
      const turn = await createTurn({
        userId: user.id,
        chatId: chat.id,
        parentId,
        content: message,
        attachments,
        assistantMetadata: assistantMeta,
      })
      assistant = turn.assistant
      contextLeafId = turn.user.id
      headers = {
        ...(assistant.parent_id
          ? { "X-Nibchat-Parent-Node": assistant.parent_id }
          : {}),
        "X-Nibchat-User-Node": turn.user.id,
      }
      const attachmentNames = attachments.map((part) => part.name)
      const titleModelConfigured =
        chat.title == null ? Boolean(await getTitleModelConfig()) : false
      const titleAction = firstTurnTitleAction(chat.title, titleModelConfigured)
      if (titleAction === "seed") {
        await maybeAssignChatTitle({
          chatId: chat.id,
          userId: user.id,
          userText: message,
          attachmentNames,
          allowLlm: false,
        })
      } else if (titleAction === "generate") {
        afterFinalize = async ({ outcome, parts }) => {
          await maybeAssignChatTitle({
            chatId: chat.id,
            userId: user.id,
            userText: message,
            attachmentNames,
            assistantText: textFromParts(parts),
            allowLlm: outcome === "complete",
          })
        }
      }
    } else if (body.intent === "regenerate") {
      const result = await startRegenerate(
        user.id,
        body.assistantNodeId,
        assistantMeta
      )
      assistant = result.assistant
      contextLeafId = result.contextLeafId
      headers = {
        ...(assistant.parent_id
          ? { "X-Nibchat-Parent-Node": assistant.parent_id }
          : {}),
      }
    } else if (body.intent === "generate") {
      const result = await startGenerate(
        user.id,
        body.parentNodeId,
        assistantMeta
      )
      assistant = result.assistant
      contextLeafId = result.contextLeafId
      headers = {
        ...(assistant.parent_id
          ? { "X-Nibchat-Parent-Node": assistant.parent_id }
          : {}),
      }
    } else {
      // resume
      const row = await db
        .selectFrom("message_nodes")
        .innerJoin("chats", "chats.id", "message_nodes.chat_id")
        .selectAll("message_nodes")
        .where("message_nodes.id", "=", body.assistantNodeId)
        .where("message_nodes.chat_id", "=", chat.id)
        .where("chats.user_id", "=", user.id)
        .executeTakeFirst()
      if (!row)
        return Response.json({ error: "Node not found" }, { status: 404 })
      if (row.status !== "awaiting_input")
        return Response.json(
          { error: "Assistant is not awaiting tool input." },
          { status: 400 }
        )

      const currentParts = nodeParts(row)
      const pending = pendingToolInvocations(currentParts)
      if (pending.length === 0)
        return Response.json(
          { error: "No pending tool invocations." },
          { status: 400 }
        )

      const resultsById = new Map(
        body.toolResults.map((r) => [r.toolCallId, r.output])
      )
      for (const inv of pending) {
        if (!resultsById.has(inv.toolCallId))
          return Response.json(
            { error: `Missing result for tool call ${inv.toolCallId}` },
            { status: 400 }
          )
      }

      const applied: Array<{ toolCallId: string; output: unknown }> = []
      for (const inv of pending) {
        const raw = resultsById.get(inv.toolCallId)
        if (inv.toolName === "question") {
          const answers =
            answersFromResumeOutput(raw) ??
            (Array.isArray(raw) ? (raw as string[][]) : null)
          if (!answers)
            return Response.json(
              { error: "Question tool expects answers arrays." },
              { status: 400 }
            )
          const validated = validateQuestionAnswers(inv.input, answers)
          if (!validated.ok)
            return Response.json({ error: validated.error }, { status: 400 })
          const questions =
            inv.input &&
            typeof inv.input === "object" &&
            Array.isArray((inv.input as { questions?: unknown }).questions)
              ? (
                  inv.input as {
                    questions: Parameters<typeof formatQuestionResult>[0]
                  }
                ).questions
              : []
          applied.push({
            toolCallId: inv.toolCallId,
            output: formatQuestionResult(questions, validated.answers),
          })
        } else {
          applied.push({ toolCallId: inv.toolCallId, output: raw })
        }
      }

      const nextParts = applyToolOutputs(currentParts, applied)
      // Claim (awaiting_input → streaming) happens inside createGenerationResponse;
      // restore originalParts if setup fails before a stream response is returned.
      assistant = {
        ...row,
        parts_json: JSON.stringify(nextParts),
        status: "streaming",
      }
      contextLeafId = assistant.id
      seedParts = nextParts
      headers = {
        ...(assistant.parent_id
          ? { "X-Nibchat-Parent-Node": assistant.parent_id }
          : {}),
      }

      const resolved = await resolveStackForChat(chat, user.id)

      const allNodes = await db
        .selectFrom("message_nodes")
        .selectAll()
        .where("chat_id", "=", chat.id)
        .orderBy("created_at")
        .execute()

      try {
        return await createGenerationResponse(
          {
            userId: user.id,
            assistant,
            contextLeafId,
            seedParts,
            config,
            languageModel,
            promptStack: resolved.stack,
            requestSignal: request.signal,
            allNodes,
            previousMetadata: assistantMeta,
            resumeClaim: { originalParts: currentParts },
          },
          headers
        )
      } catch (error) {
        if (error instanceof ResumeClaimError) {
          const status = error.kind === "missing" ? 404 : 409
          return Response.json({ error: error.message }, { status })
        }
        throw error
      }
    }

      const resolved = await resolveStackForChat(chat, user.id)

    const allNodes = await db
      .selectFrom("message_nodes")
      .selectAll()
      .where("chat_id", "=", chat.id)
      .orderBy("created_at")
      .execute()

    return await createGenerationResponse(
      {
        userId: user.id,
        assistant,
        contextLeafId,
        seedParts,
        config,
        languageModel,
        promptStack: resolved.stack,
        requestSignal: request.signal,
        allNodes,
        previousMetadata: assistantMeta,
        afterFinalize,
      },
      headers
    )
  } catch (error) {
    console.error("[nibchat/stream] setup", error)
    if (statusFromError(error) !== 400) return jsonError(error)
    return Response.json({ error: formatProviderError(error) }, { status: 400 })
  }
}

function uniqueAttachmentReferences(references: AttachmentReference[]) {
  const seen = new Set<string>()
  return references.filter((reference) => {
    const key =
      reference.kind === "mcp-resource"
        ? `${reference.kind}\u0000${reference.profileId}\u0000${reference.uri}`
        : `${reference.kind}\u0000${reference.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
