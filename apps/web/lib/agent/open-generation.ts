import "server-only"
import {
  startGenerationProducer,
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

export async function startChatGeneration(input: {
  userId: string
  chat: Pick<ChatRow, "id" | "settings_json" | "space_id">
  settings: ResolvedSettings
  config: ModelConfig
  languageModel: Awaited<ReturnType<typeof modelFor>>
  responsesReplay?: ResponsesReplayTarget
  assistant: NodeRow
  contextLeafId: string | null
  seedParts?: Parts
  timeZone: string
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
  return startGenerationProducer({
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
    allNodes,
    previousMetadata: input.previousMetadata,
    resumeClaim: input.resumeClaim,
    afterFinalize: input.afterFinalize,
    generationId: input.generationId,
  })
}

/** Continue an existing chat from a parent node and retain the producer. */
export async function continueChatGeneration(input: {
  userId: string
  chatId: string
  parentId: string | null
  timeZone: string
  attachSelection?: boolean
  /** Resolved generation settings captured by a delayed chat action. */
  settingsJson?: string
  afterFinalize?: GenerationSetup["afterFinalize"]
  onStarted?: (assistantId: string) => Promise<void>
  batch?: { id: string; index: number; size: number }
  existing?: { assistant: NodeRow; generationId: string }
}) {
  const chat = await db
    .selectFrom("chats")
    .selectAll()
    .where("id", "=", input.chatId)
    .where("user_id", "=", input.userId)
    .executeTakeFirst()
  if (!chat) throw new Error("Chat not found")
  if (input.settingsJson) chat.settings_json = input.settingsJson
  const stored = parseSettingValues(chat.settings_json)
  const storedModel = stored.model
  const normalizedModel = storedModel
    ? await resolveModelConfig(input.userId, storedModel)
    : storedModel
  if (
    !input.settingsJson &&
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
  const generationId = input.existing?.generationId ?? crypto.randomUUID()
  const assistantMeta = {
    ...generationAssistantMeta(config, responsesReplay),
    ...(input.batch
      ? {
          batchId: input.batch.id,
          batchIndex: input.batch.index,
          batchSize: input.batch.size,
        }
      : {}),
  }
  const { assistant, contextLeafId } = input.existing
    ? { assistant: input.existing.assistant, contextLeafId: input.parentId }
    : await startGeneration({
        userId: input.userId,
        chatId: chat.id,
        parentId: input.parentId,
        generationId,
        assistantMetadata: assistantMeta,
        attachSelection: input.attachSelection,
      })
  await input.onStarted?.(assistant.id)
  return startChatGeneration({
    userId: input.userId,
    chat,
    settings,
    config,
    languageModel,
    responsesReplay,
    assistant,
    contextLeafId,
    timeZone: input.timeZone,
    generationId,
    afterFinalize: input.afterFinalize,
    previousMetadata: assistantMeta,
  })
}
