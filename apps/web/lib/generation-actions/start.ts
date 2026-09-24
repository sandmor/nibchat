import "server-only"
import { ResumeClaimError } from "@/lib/agent/run-generation"
import {
  generationAssistantMeta,
  startChatGeneration,
} from "@/lib/agent/open-generation"
import {
  applyToolOutputs,
  pendingToolInvocations,
  uniqueAttachmentReferences,
} from "@/lib/agent/parts"
import {
  answersFromResumeOutput,
  formatQuestionResult,
  validateQuestionAnswers,
} from "@/lib/agent/tools"
import {
  finalizeStreamingAssistantWithSnapshot,
  maybeAssignChatTitle,
  nodeParts,
  loadEditSourceUserNode,
  resolveSettingsForChat,
  startGenerationBatch,
  submitUserTurnBatch,
} from "@/lib/chat-service"
import { db } from "@/lib/db"
import {
  actionMatchesRequest,
  getGenerationAction,
} from "@/lib/generation-actions"
import { generationActionSseResponse } from "@/lib/generation-actions-stream"
import { generationLifetime } from "@/lib/generation-streams/default-port"
import { parseJson } from "@/lib/domain"
import { formatProviderError } from "@/lib/provider-errors"
import {
  modelFor,
  pdfInputModeFor,
  responsesReplayTargetFor,
  resolveModelConfig,
  type ModelConfig,
} from "@/lib/providers"
import { resolveConversationAttachments } from "@/lib/conversation-attachments"
import { assertPdfFallbackAvailable } from "@/lib/pdf-input"
import { firstTurnTitleAction } from "@/lib/chat-title"
import {
  parseSettingValues,
  settingValuesToJson,
  valuesEqual,
} from "@/lib/chat-settings"
import { withModelFallback } from "@/lib/providers"
import type { NodeRow, Parts } from "@/lib/types"
import type { GenerationStartBody } from "@/lib/generation-start"

/** Create the durable action and start its producers. HTTP parsing lives in the route. */
export async function startGenerationAction(input: {
  user: { id: string }
  body: GenerationStartBody
  requestHash: string
}) {
  const { user, body, requestHash } = input
  const retry = { chatId: body.chatId, requestHash }
  const chat = await db
    .selectFrom("chats")
    .selectAll()
    .where("id", "=", body.chatId)
    .where("user_id", "=", user.id)
    .executeTakeFirst()
  if (!chat) return Response.json({ error: "Chat not found" }, { status: 404 })
  const stored = parseSettingValues(chat.settings_json)
  const storedModel = stored.model
  const normalizedModel = storedModel
    ? await resolveModelConfig(user.id, storedModel)
    : storedModel
  if (
    storedModel &&
    normalizedModel &&
    !valuesEqual(storedModel, normalizedModel)
  ) {
    const next = { ...stored, model: normalizedModel }
    await db
      .updateTable("chats")
      .set({
        settings_json: settingValuesToJson(next),
        updated_at: new Date().toISOString(),
      })
      .where("id", "=", chat.id)
      .execute()
    chat.settings_json = settingValuesToJson(next)
  }
  const settings = await resolveSettingsForChat(chat, user.id)
  let config = await withModelFallback(user.id, settings.effective.model)
  let languageModel = await modelFor(user.id, config, {
    chatId: chat.id,
    timeZone: body.timeZone,
  })
  let responsesReplay = await responsesReplayTargetFor(user.id, config)
  let assistantMeta = generationAssistantMeta(config, responsesReplay)
  const replyCount = body.intent === "resume" ? 1 : (body.replyCount ?? 1)
  const batchId = body.actionId
  const generationIds = Array.from({ length: replyCount }, () =>
    crypto.randomUUID()
  )

  let assistants: NodeRow[] = []
  let contextLeafId: string | null
  let seedParts: Parts = []

  if (body.intent === "submit") {
    const message = body.content.trim()
    const references = uniqueAttachmentReferences(body.attachments ?? [])
    if (!message && references.length === 0)
      return Response.json({ error: "Message is required" }, { status: 400 })
    const parentId = body.parentNodeId ?? null
    const sourceParts = body.editedFromNodeId
      ? nodeParts(
          await loadEditSourceUserNode(
            user.id,
            chat.id,
            body.editedFromNodeId,
            parentId
          )
        )
      : []
    const attachments = await resolveConversationAttachments({
      userId: user.id,
      references,
      sourceParts,
    })
    if ((await pdfInputModeFor(user.id, config)) === "extracted")
      assertPdfFallbackAvailable(attachments)
    const attachmentNames = attachments.map((part) => part.name)
    const titleModel = settings.effective.title.model
    const titleModelConfigured =
      settings.effective.title.strategy === "generate"
    const titleAction = firstTurnTitleAction(
      chat.title,
      titleModelConfigured,
      body.editedFromNodeId
    )
    const { user: userMessage, assistants: generationAssistants } =
      await submitUserTurnBatch({
        userId: user.id,
        chatId: chat.id,
        parentId,
        parts: [
          ...attachments,
          ...(message ? [{ type: "text" as const, text: message }] : []),
        ],
        generationIds,
        assistantMetadata: { ...assistantMeta, batchId },
        attachSelection: body.attachSelection,
        action: { id: body.actionId, requestHash, intent: body.intent },
      })
    assistants = generationAssistants
    contextLeafId = userMessage.id
    if (titleAction !== "skip") {
      const titleTask = maybeAssignChatTitle({
        chatId: chat.id,
        userId: user.id,
        userText: message,
        attachmentNames,
        allowLlm: titleAction === "generate",
        titleModel:
          titleModel?.providerId && titleModel.model
            ? { providerId: titleModel.providerId, model: titleModel.model }
            : null,
        titleInstructions: settings.effective.title.instructions,
      }).catch((error) => console.warn("[nibchat/title]", error))
      if (titleAction === "seed") await titleTask
      else generationLifetime.retain(titleTask)
    }
  } else if (body.intent === "generate") {
    const result = await startGenerationBatch({
      userId: user.id,
      chatId: chat.id,
      parentId: body.parentNodeId ?? null,
      generationIds,
      assistantMetadata: { ...assistantMeta, batchId },
      attachSelection: body.attachSelection,
      action: { id: body.actionId, requestHash, intent: body.intent },
    })
    assistants = result.assistants
    contextLeafId = result.contextLeafId
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
    if (!row) return Response.json({ error: "Node not found" }, { status: 404 })
    if (row.status !== "awaiting_input") {
      const raced = await getGenerationAction(body.actionId, user.id)
      if (raced && actionMatchesRequest(raced, retry))
        return generationActionSseResponse(raced, null)
      return Response.json(
        { error: "Assistant is not awaiting tool input." },
        { status: 400 }
      )
    }

    const currentParts = nodeParts(row)
    const priorMetadata = parseJson<Record<string, unknown>>(
      row.metadata_json,
      {}
    )
    const priorConfig = parseGenerationConfig(priorMetadata.generationConfig)
    if (priorConfig) {
      // A paused assistant is one generation. Resuming it with a newly
      // selected provider would create a node whose parts have incompatible
      // provenance, so retain the original selection.
      config = priorConfig
      languageModel = await modelFor(user.id, config, {
        chatId: chat.id,
        timeZone: body.timeZone,
        requireConfiguredModel: true,
      })
      responsesReplay = await responsesReplayTargetFor(user.id, config)
      assistantMeta = generationAssistantMeta(config, responsesReplay)
    }
    // A resumed tool turn may be finished after the chat selection changed.
    // Keep its old metadata identity so provider-native replay is disabled
    // rather than attaching earlier items to the new profile/model.
    const resumeMetadata =
      priorMetadata.provider === config.providerId &&
      priorMetadata.model === config.model
        ? assistantMeta
        : {}
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
    // Claim (awaiting_input → streaming) happens when the producer starts;
    // restore originalParts if setup fails before startup completes.
    const assistant: NodeRow = {
      ...row,
      parts_json: JSON.stringify(nextParts),
      status: "streaming",
    }
    contextLeafId = assistant.id
    seedParts = nextParts
    assistants = [assistant]

    try {
      await startChatGeneration({
        userId: user.id,
        chat,
        settings,
        config,
        languageModel,
        responsesReplay,
        assistant,
        contextLeafId,
        seedParts,
        timeZone: body.timeZone,
        previousMetadata: resumeMetadata,
        resumeClaim: {
          originalParts: currentParts,
          action: {
            id: body.actionId,
            userId: user.id,
            chatId: chat.id,
            requestHash,
          },
        },
        generationId: generationIds[0]!,
      })
      const receipt = await getGenerationAction(body.actionId, user.id)
      if (!receipt) throw new Error("Action receipt was not saved")
      return generationActionSseResponse(receipt, null)
    } catch (error) {
      if (error instanceof ResumeClaimError) {
        const raced = await getGenerationAction(body.actionId, user.id)
        if (raced && actionMatchesRequest(raced, retry))
          return generationActionSseResponse(raced, null)
        const status = error.kind === "missing" ? 404 : 409
        return Response.json({ error: error.message }, { status })
      }
      throw error
    }
  }

  const startup = Promise.allSettled(
    assistants.map(async (assistant, index) => {
      try {
        const siblingModel =
          index === 0
            ? languageModel
            : await modelFor(user.id, config, {
                chatId: chat.id,
                timeZone: body.timeZone,
              })
        await startChatGeneration({
          userId: user.id,
          chat,
          settings,
          config,
          languageModel: siblingModel,
          responsesReplay,
          assistant,
          contextLeafId,
          seedParts,
          timeZone: body.timeZone,
          previousMetadata: {
            ...assistantMeta,
            batchId,
            batchIndex: index,
            batchSize: replyCount,
          },
          generationId: generationIds[index]!,
        })
      } catch (error) {
        console.error("[nibchat/generation-start] sibling", error)
        await finalizeStreamingAssistantWithSnapshot({
          nodeId: assistant.id,
          generationId: generationIds[index],
          outcome: "error",
          parts: [],
          error: formatProviderError(error),
        })
      }
    })
  )
  // The durable nodes and runs already exist. Return their handles now;
  // each reader waits for its producer to open and replays any early events.
  generationLifetime.retain(startup)
  const receipt = await getGenerationAction(body.actionId, user.id)
  if (!receipt) throw new Error("Action receipt was not saved")
  return generationActionSseResponse(receipt, null)
}

function parseGenerationConfig(value: unknown): ModelConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined
  const config = value as ModelConfig
  return typeof config.providerId === "string" &&
    typeof config.model === "string"
    ? config
    : undefined
}
