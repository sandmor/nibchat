import "server-only"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import { db } from "@/lib/db"
import { parseJson } from "@/lib/domain"

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
  /**
   * OpenAI-compatible providers vary widely in whether they accept native
   * reasoning message parts. Direct adapters are known to support them; a
   * compatible endpoint must opt in explicitly.
   */
  replayReasoning?: boolean
}
export async function listProviders(userId: string) {
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
    .where("user_id", "=", userId)
    .execute()
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
    .where("user_id", "=", userId)
    .orderBy("created_at", "asc")
    .executeTakeFirst()
  if (!provider) return {}
  const models = parseJson<string[]>(provider.models_json, [])
  return {
    providerId: provider.id,
    ...(models[0] ? { model: models[0] } : {}),
  }
}

export async function modelFor(
  userId: string,
  config: ModelConfig
): Promise<LanguageModel> {
  const profile = config.providerId
    ? await db
        .selectFrom("provider_profiles")
        .selectAll()
        .where("id", "=", config.providerId)
        .where("user_id", "=", userId)
        .executeTakeFirst()
    : undefined
  const model =
    config.model || parseJson<string[]>(profile?.models_json ?? "[]", [])[0]
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
  if (!apiKey?.trim()) {
    const envHint = profile.api_key_env
      ? ` or set the ${profile.api_key_env} environment variable`
      : ""
    throw new Error(
      `Missing API key for provider "${profile.name}". Add a key in Settings${envHint}.`
    )
  }
  if (profile.kind === "anthropic") return createAnthropic({ apiKey })(model)
  if (profile.kind === "openai")
    return createOpenAI({ apiKey, baseURL: profile.base_url ?? undefined })(
      model
    )
  return createOpenAICompatible({
    name: profile.name,
    apiKey,
    baseURL: profile.base_url ?? "",
  })(model)
}

export async function canReplayReasoning(userId: string, config: ModelConfig) {
  if (!config.providerId) return false
  const profile = await db
    .selectFrom("provider_profiles")
    .select("kind")
    .where("id", "=", config.providerId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!profile) return false
  return profile.kind === "openai" || profile.kind === "anthropic"
    ? config.replayReasoning !== false
    : config.replayReasoning === true
}
