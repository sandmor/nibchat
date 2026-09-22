import "server-only"
import {
  createGenerationResponse,
  type GenerationSetup,
} from "@/lib/agent/run-generation"
import type { Parts } from "@/lib/agent/parts"
import {
  resolveSettingsForChat,
  resolveStackForChat,
  startGeneration,
} from "@/lib/chat-service"
import {
  parseSettingValues,
  settingValuesToJson,
  valuesEqual,
  type ResolvedSettings,
} from "@/lib/chat-settings"
import { db } from "@/lib/db"
import { formatSpaceRules } from "@/lib/spaces"
import {
  modelFor,
  rememberCatalogProtocol,
  responsesReplayTargetFor,
  resolveModelConfig,
  selectedProtocolFor,
  withModelFallback,
  type ModelConfig,
  type ResponsesReplayTarget,
} from "@/lib/providers"
import type { ChatRow, NodeRow } from "@/lib/types"

export function generationAssistantMeta(
  config: ModelConfig,
  responsesReplay?: ResponsesReplayTarget
) {
  return {
    provider: config.providerId,
    model: config.model,
    generationConfig: config,
    startedAt: new Date().toISOString(),
    ...(responsesReplay
      ? { responsesProviderOptionsKey: responsesReplay.providerOptionsKey }
      : {}),
  }
}

export async function openGenerationResponse(input: {
  userId: string
  chat: Pick<ChatRow, "id" | "settings_json" | "space_id">
  settings: ResolvedSettings
  config: ModelConfig
  languageModel: Awaited<ReturnType<typeof modelFor>>
  responsesReplay?: ResponsesReplayTarget
  assistant: NodeRow
  contextLeafId: string | null
  seedParts?: Parts
  headers?: Record<string, string>
  timeZone: string
  requestSignal: AbortSignal
  generationId: string
  afterFinalize?: GenerationSetup["afterFinalize"]
  previousMetadata?: Record<string, unknown>
  resumeClaim?: GenerationSetup["resumeClaim"]
}) {
  const resolved = await resolveStackForChat(input.chat, input.userId)
  const allNodes = await db
    .selectFrom("message_nodes")
    .selectAll()
    .where("chat_id", "=", input.chat.id)
    .orderBy("created_at")
    .execute()
  const config = input.config
  return createGenerationResponse(
    {
      userId: input.userId,
      assistant: input.assistant,
      contextLeafId: input.contextLeafId,
      seedParts: input.seedParts,
      config,
      languageModel: input.languageModel,
      responsesReplay: input.responsesReplay,
      selectedProtocol: () => selectedProtocolFor(input.languageModel),
      rememberProtocol:
        config.providerId && config.model
          ? (protocol) =>
              rememberCatalogProtocol(
                config.providerId!,
                config.model!,
                protocol as "responses" | "chat"
              )
          : undefined,
      promptStack: resolved.stack,
      variableOverrides: input.settings.effective.variables,
      spaceRulesText: formatSpaceRules(input.settings.effective.rules),
      timeZone: input.timeZone,
      requestSignal: input.requestSignal,
      allNodes,
      previousMetadata: input.previousMetadata,
      resumeClaim: input.resumeClaim,
      afterFinalize: input.afterFinalize,
      generationId: input.generationId,
    },
    input.headers ?? {}
  )
}

/** Continue an existing chat from a parent node and retain the producer. */
export async function continueChatGeneration(input: {
  userId: string
  chatId: string
  parentId: string | null
  timeZone: string
  requestSignal: AbortSignal
  attachSelection?: boolean
  afterFinalize?: GenerationSetup["afterFinalize"]
}) {
  const chat = await db
    .selectFrom("chats")
    .selectAll()
    .where("id", "=", input.chatId)
    .where("user_id", "=", input.userId)
    .executeTakeFirst()
  if (!chat) throw new Error("Chat not found")
  const stored = parseSettingValues(chat.settings_json)
  const storedModel = stored.model
  const normalizedModel = storedModel
    ? await resolveModelConfig(input.userId, storedModel)
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
  const settings = await resolveSettingsForChat(chat, input.userId)
  const config = await withModelFallback(input.userId, settings.effective.model)
  const languageModel = await modelFor(input.userId, config, {
    chatId: chat.id,
    timeZone: input.timeZone,
  })
  const responsesReplay = await responsesReplayTargetFor(input.userId, config)
  const generationId = crypto.randomUUID()
  const assistantMeta = generationAssistantMeta(config, responsesReplay)
  const { assistant, contextLeafId } = await startGeneration({
    userId: input.userId,
    chatId: chat.id,
    parentId: input.parentId,
    generationId,
    assistantMetadata: assistantMeta,
    attachSelection: input.attachSelection,
  })
  return openGenerationResponse({
    userId: input.userId,
    chat,
    settings,
    config,
    languageModel,
    responsesReplay,
    assistant,
    contextLeafId,
    headers: assistant.parent_id
      ? { "X-Nibchat-Parent-Node": assistant.parent_id }
      : {},
    timeZone: input.timeZone,
    requestSignal: input.requestSignal,
    generationId,
    afterFinalize: input.afterFinalize,
    previousMetadata: assistantMeta,
  })
}
