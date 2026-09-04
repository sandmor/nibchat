import { z } from "zod"
import {
  preprocessConfigEntries,
  configEntrySchema,
  type ConfigEntry,
} from "@/lib/config-entries"

export const providerConnectionConfigSchema = z.object({
  baseUrl: z.string().trim().max(2_000).optional(),
  headers: z.preprocess(
    preprocessConfigEntries,
    z.array(configEntrySchema).max(100)
  ),
})

export type ProviderConnectionConfig = z.infer<
  typeof providerConnectionConfigSchema
>
export type ProviderConnectionConfigInput = z.input<
  typeof providerConnectionConfigSchema
>

export function providerConfigForStorage(
  config: ProviderConnectionConfig
): ProviderConnectionConfig {
  return {
    ...(config.baseUrl?.trim() ? { baseUrl: config.baseUrl.trim() } : {}),
    headers: config.headers.map(({ name, value }) => ({ name, value })),
  }
}

export function providerConfigFromJson(raw: string): ProviderConnectionConfig {
  let parsed: unknown = {}
  try {
    parsed = JSON.parse(raw)
  } catch {
    // A corrupt profile should remain editable so the owner can repair it.
  }
  return providerConnectionConfigSchema.catch({ headers: [] }).parse(parsed)
}

export function defaultProviderHeaders(
  kind: "openai" | "anthropic" | "ollama" | "openai-compatible",
  options: { ollamaCloud?: boolean } = {}
): ConfigEntry[] {
  if (kind === "openai")
    return [{ name: "Authorization", value: "Bearer ${OPENAI_API_KEY}" }]
  if (kind === "anthropic")
    return [{ name: "x-api-key", value: "${ANTHROPIC_API_KEY}" }]
  if (kind === "ollama" && options.ollamaCloud)
    return [{ name: "Authorization", value: "Bearer ${OLLAMA_API_KEY}" }]
  return []
}
