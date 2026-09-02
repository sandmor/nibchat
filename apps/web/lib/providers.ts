import "server-only"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createOpenResponses } from "@ai-sdk/open-responses"
import { createHash } from "node:crypto"
import type { LanguageModel } from "ai"
import { db } from "@/lib/db"
import { parseJson } from "@/lib/domain"
import { isOllamaCloudUrl, ollamaApiUrl } from "@/lib/ollama"
import {
  firstEnabledModelId,
  isEnabledModelId,
  parseProviderModelsJson,
} from "@/lib/provider-models"
import {
  isProviderProtocol,
  type ProviderProtocol,
  type CatalogModel,
} from "@/lib/provider-catalog"
import { replayReasoningEnabled } from "@/lib/reasoning-replay"
import {
  openAIResponsesModel,
  protocolRoutedModel,
} from "@/lib/openai-responses"

export type ModelConfig = {
  providerId?: string
  model?: string
  temperature?: number
  maxOutputTokens?: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
  stopSequences?: string[]
  providerOptions?: Record<string, unknown>
  /** Set false to omit reasoning from replay, even on a Responses endpoint. */
  replayReasoning?: boolean
}

/** Identifies the only Responses metadata that may be replayed for a turn. */
export type ResponsesReplayTarget = {
  providerId: string
  model: string
  providerOptionsKey: string
}

export async function responsesReplayTargetFor(
  userId: string,
  config: ModelConfig
): Promise<ResponsesReplayTarget | undefined> {
  if (!config.providerId || !config.model) return undefined
  const profile = await db
    .selectFrom("provider_profiles")
    .select(["id", "kind", "name"])
    .where("id", "=", config.providerId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!profile || profile.kind === "anthropic") return undefined
  const configured = parseProviderModelsJson(
    (
      await db
        .selectFrom("provider_profiles")
        .select("models_json")
        .where("id", "=", profile.id)
        .executeTakeFirst()
    )?.models_json ?? "[]"
  ).find((entry) => entry.id === config.model)
  const catalog = await catalogModelFor(profile.id, config.model)
  const cachedProtocol = effectiveCatalogProtocol(catalog)
  const protocol =
    configured?.protocol && configured.protocol !== "auto"
      ? configured.protocol
      : (cachedProtocol ?? "responses")
  // Only the Responses adapters understand encrypted reasoning and item
  // metadata. Chat receives the portable local transcript.
  if (protocol !== "responses") return undefined
  return {
    providerId: profile.id,
    model: config.model,
    providerOptionsKey:
      profile.kind === "openai"
        ? "openai"
        : profile.kind === "ollama"
          ? "ollama"
          : profile.name,
  }
}
export async function listProviders() {
  return db
    .selectFrom("provider_profiles")
    .select([
      "id",
      "name",
      "kind",
      "base_url",
      "api_key_env",
      "models_json",
      "created_at",
      "updated_at",
    ])
    .execute()
}

/** Safe catalog used by regular users to choose an enabled model. */
export async function listAvailableProviders() {
  const rows = await db
    .selectFrom("provider_profiles")
    .select(["id", "name", "kind", "models_json", "created_at", "updated_at"])
    .orderBy("name")
    .execute()
  return rows.map((row) => ({
    ...row,
    base_url: null as string | null,
    api_key_env: null as string | null,
  }))
}

/** Seed newly created chats from the latest chat or first provider profile. */
export async function defaultModelConfig(userId: string): Promise<ModelConfig> {
  const recent = await db
    .selectFrom("chats")
    .select("model_config_json")
    .where("user_id", "=", userId)
    .orderBy("updated_at", "desc")
    .limit(1)
    .executeTakeFirst()
  if (recent) {
    const cfg = parseJson<ModelConfig>(recent.model_config_json, {})
    if (cfg.providerId) {
      return {
        providerId: cfg.providerId,
        ...(cfg.model ? { model: cfg.model } : {}),
      }
    }
  }
  const provider = await db
    .selectFrom("provider_profiles")
    .select(["id", "models_json"])
    .orderBy("created_at", "asc")
    .executeTakeFirst()
  if (!provider) return {}
  const model = firstEnabledModelId(
    parseProviderModelsJson(provider.models_json)
  )
  return {
    providerId: provider.id,
    ...(model ? { model } : {}),
  }
}

export async function modelFor(
  userId: string,
  config: ModelConfig,
  options?: { requireConfiguredModel?: boolean; chatId?: string }
): Promise<LanguageModel> {
  const profile = config.providerId
    ? await db
        .selectFrom("provider_profiles")
        .selectAll()
        .where("id", "=", config.providerId)
        .executeTakeFirst()
    : undefined
  const enabledModels = parseProviderModelsJson(profile?.models_json ?? "[]")
  const configuredModel = config.model
  const model =
    configuredModel && isEnabledModelId(enabledModels, configuredModel)
      ? configuredModel
      : options?.requireConfiguredModel
        ? undefined
        : firstEnabledModelId(enabledModels)
  if (!profile || !model)
    throw new Error(
      "Choose a provider and model in Settings before sending a message."
    )
  if (profile.kind === "openai-compatible" && !profile.base_url?.trim()) {
    throw new Error(
      `Provider "${profile.name}" needs a base URL (e.g. your gateway) before it can send requests.`
    )
  }
  const apiKey =
    profile.api_key ??
    (profile.api_key_env ? process.env[profile.api_key_env] : undefined)
  const ollamaCloud =
    profile.kind === "ollama" && isOllamaCloudUrl(profile.base_url)
  if (!apiKey?.trim() && (profile.kind !== "ollama" || ollamaCloud)) {
    const envHint = profile.api_key_env
      ? ` or set the ${profile.api_key_env} environment variable`
      : ""
    throw new Error(
      `Missing API key for provider "${profile.name}". Add a key in Settings${envHint}.`
    )
  }
  if (profile.kind === "anthropic")
    return createAnthropic({
      apiKey,
      ...(profile.base_url ? { baseURL: profile.base_url } : {}),
    })(model)
  const providerName = profile.kind === "ollama" ? "ollama" : profile.name
  const baseURL =
    profile.kind === "ollama"
      ? ollamaApiUrl(profile.base_url, "v1")
      : (profile.base_url ?? undefined)
  const promptCacheKey =
    profile.kind === "openai" && options?.chatId
      ? createHash("sha256")
          .update(`${userId}\0${profile.id}\0${model}\0${options.chatId}`)
          .digest("hex")
      : undefined
  const responsesApiKey =
    profile.kind === "ollama" && !ollamaCloud
      ? undefined
      : apiKey?.trim() || undefined
  if (profile.kind === "openai") {
    const provider = createOpenAI({
      apiKey: apiKey?.trim(),
      baseURL,
    })
    return openAIResponsesModel({
      model: provider.responses(model),
      promptCacheKey,
      defaultReasoningSummary: isReasoningModel(model),
    })
  }
  const preference = enabledModels.find((item) => item.id === model)?.protocol
  const catalog = await catalogModelFor(profile.id, model)
  const cachedProtocol = effectiveCatalogProtocol(catalog)
  const preferred =
    preference && preference !== "auto"
      ? preference
      : (cachedProtocol ?? "responses")
  const protocols = orderProtocols(preferred)
  // A catalog endpoint describes its advertised protocol only. Fallback
  // adapters start from the configured provider base rather than appending a
  // second protocol path to that endpoint.
  const routeBaseFor = (protocol: ProviderProtocol) =>
    catalog?.endpoint && protocol === cachedProtocol
      ? catalog.endpoint
      : baseURL
  const candidates = protocols.map((protocol) => {
    const routeBase = routeBaseFor(protocol)
    if (protocol === "responses")
      return {
        protocol,
        model: createOpenResponses({
          name: providerName,
          url: openResponsesUrl(routeBase),
          apiKey: responsesApiKey,
        })(model),
      }
    return {
      protocol,
      model: createOpenAICompatible({
        name: providerName,
        apiKey: profile.kind === "ollama" && !ollamaCloud ? undefined : apiKey,
        baseURL: openChatCompletionsBaseUrl(routeBase),
        supportsStructuredOutputs: profile.kind === "ollama" ? true : undefined,
      })(model),
    }
  })
  return protocolRoutedModel({
    candidates,
    // An explicit user override is a contract, not a probe.
    allowFallback: preference === undefined || preference === "auto",
  })
}

function openResponsesUrl(baseURL: string | undefined) {
  const normalized = (baseURL ?? "").replace(/\/+$/, "")
  return normalized.endsWith("/responses")
    ? normalized
    : `${normalized}/responses`
}

function openChatCompletionsBaseUrl(baseURL: string | undefined) {
  return (baseURL ?? "").replace(/\/(responses|chat\/completions)\/?$/, "")
}

function orderProtocols(preferred: ProviderProtocol): ProviderProtocol[] {
  return preferred === "responses"
    ? ["responses", "chat"]
    : ["chat", "responses"]
}

async function catalogModelFor(providerId: string, modelId: string) {
  const cached = await db
    .selectFrom("model_catalog_cache")
    .select("models_json")
    .where("provider_id", "=", providerId)
    .executeTakeFirst()
  const models = parseJson<CatalogModel[]>(cached?.models_json ?? "[]", [])
  return models.find((entry) => entry.id === modelId)
}

function effectiveCatalogProtocol(
  catalog: CatalogModel | undefined
): ProviderProtocol | undefined {
  return isProviderProtocol(catalog?.learnedProtocol)
    ? catalog.learnedProtocol
    : isProviderProtocol(catalog?.protocol)
      ? catalog.protocol
      : undefined
}

/** Persist a verified route only after a completed generation; a catalog refresh replaces it. */
export async function rememberCatalogProtocol(
  providerId: string,
  modelId: string,
  protocol: ProviderProtocol
) {
  const row = await db
    .selectFrom("model_catalog_cache")
    .select("models_json")
    .where("provider_id", "=", providerId)
    .executeTakeFirst()
  if (!row) return
  const models = parseJson<CatalogModel[]>(row.models_json, [])
  const index = models.findIndex((entry) => entry.id === modelId)
  if (index < 0) return
  const next = [...models]
  next[index] = {
    ...next[index]!,
    learnedProtocol: protocol,
    learnedAt: new Date().toISOString(),
  }
  await db
    .updateTable("model_catalog_cache")
    .set({ models_json: JSON.stringify(next) })
    .where("provider_id", "=", providerId)
    .execute()
}

export function selectedProtocolFor(
  model: LanguageModel
): ProviderProtocol | undefined {
  const selected = (
    model as LanguageModel & { selectedProtocol?: () => ProviderProtocol }
  ).selectedProtocol
  return selected?.()
}

function isReasoningModel(model: string) {
  return /^(o[1-4]|gpt-5)(?:$|[-.])/i.test(model)
}

/** Resolve stale chat selections to the provider's current first enabled model. */
export async function resolveModelConfig(
  userId: string,
  config: ModelConfig
): Promise<ModelConfig> {
  if (!config.providerId) return config
  const profile = await db
    .selectFrom("provider_profiles")
    .select("models_json")
    .where("id", "=", config.providerId)
    .executeTakeFirst()
  if (!profile) return config
  const models = parseProviderModelsJson(profile.models_json)
  if (
    config.model &&
    models.some((model) => model.enabled && model.id === config.model)
  )
    return config
  const model = firstEnabledModelId(models)
  return { ...config, ...(model ? { model } : { model: undefined }) }
}

export async function canReplayReasoning(userId: string, config: ModelConfig) {
  if (!config.providerId) return false
  const profile = await db
    .selectFrom("provider_profiles")
    .select("kind")
    .where("id", "=", config.providerId)
    .executeTakeFirst()
  if (!profile) return false
  return replayReasoningEnabled(profile.kind, config.replayReasoning)
}

export async function pdfInputModeFor(
  userId: string,
  config: ModelConfig
): Promise<"native" | "extracted"> {
  if (!config.providerId) return "extracted"
  const profile = await db
    .selectFrom("provider_profiles")
    .select(["kind", "models_json"])
    .where("id", "=", config.providerId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!profile) return "extracted"
  const model = parseProviderModelsJson(profile.models_json).find(
    (item) => item.id === config.model
  )
  return model?.pdfInput ?? "extracted"
}
