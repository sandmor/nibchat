import "server-only"
import {
  startGenerationProducer,
  type GenerationSetup,
} from "@/lib/agent/run-generation"
import type { AgentGenerationOptions } from "@/lib/agent/generation-options"
import type { Parts } from "@/lib/agent/parts"
import { readStackJson, type PromptStackDocument } from "@/lib/prompt-stack"
import { branchIdOf, parseJson } from "@/lib/domain"
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
  replaySeedParts?: boolean
  timeZone: string
  generationId: string
  afterFinalize?: GenerationSetup["afterFinalize"]
  previousMetadata?: Record<string, unknown>
  resumeClaim?: GenerationSetup["resumeClaim"]
  agent?: AgentGenerationOptions
}) {
  const resolved = await resolveStackForChat(input.chat, input.userId)
  const agentConfig = await db
    .selectFrom("chats")
    .select("agent_config_json")
    .where("id", "=", input.chat.id)
    .where("user_id", "=", input.userId)
    .executeTakeFirst()
  const snapshot = parseJson<{ stack?: PromptStackDocument }>(
    agentConfig?.agent_config_json ?? "{}",
    {}
  )
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
    replaySeedParts: input.replaySeedParts,
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
    promptStack: snapshot.stack
      ? readStackJson(JSON.stringify(snapshot.stack))
      : resolved.stack,
    variableOverrides: input.settings.effective.variables,
    spaceRulesText: formatSpaceRules(input.settings.effective.rules),
    timeZone: input.timeZone,
    allNodes,
    previousMetadata: input.previousMetadata,
    resumeClaim: input.resumeClaim,
    afterFinalize: input.afterFinalize,
    generationId: input.generationId,
    ...input.agent,
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
  agent?: AgentGenerationOptions
  batch?: { id: string; index: number; size: number }
  existing?: { assistant: NodeRow; generationId: string; seedParts?: Parts }
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
  const agentSnapshot = parseJson<{ model?: ModelConfig }>(
    chat.agent_config_json ?? "{}",
    {}
  )
  const config = await withModelFallback(
    input.userId,
    agentSnapshot.model ?? settings.effective.model
  )
  const helperPolicy =
    chat.kind === "agent_run"
      ? ({
          question: true,
          task:
            parseJson<{ allowTask?: boolean }>(
              chat.agent_config_json ?? "{}",
              {}
            ).allowTask !== false,
          mcp:
            parseJson<{ mcpMode?: "inherit" | "none" }>(
              chat.agent_config_json ?? "{}",
              {}
            ).mcpMode ?? "inherit",
        } as const)
      : undefined
  const responsesReplay = await responsesReplayTargetFor(input.userId, config)
  const generationId = input.existing?.generationId ?? crypto.randomUUID()
  const assistantMeta = {
    ...generationAssistantMeta(config, responsesReplay),
    timeZone: input.timeZone,
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
  const branchNodes = await db
    .selectFrom("message_nodes")
    .select(["id", "parent_id", "branch_index"])
    .where("chat_id", "=", chat.id)
    .execute()
  const languageModel = await modelFor(input.userId, config, {
    chatId: chat.id,
    timeZone: input.timeZone,
    branchId: branchIdOf(branchNodes, assistant.id),
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
    seedParts: input.existing?.seedParts,
    replaySeedParts: Boolean(input.existing),
    agent: {
      ...input.agent,
      toolPolicy: helperPolicy ?? input.agent?.toolPolicy,
    },
  })
}
