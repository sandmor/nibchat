import { z } from "zod"
import { parseJson } from "@/lib/domain"
import { MAX_COLLECTION } from "@/lib/limits"
import { promptVariableValueSchema } from "@/lib/prompt-stack"
import {
  GENERATION_SETTING_KEYS,
  layerCanPersist,
  PRODUCT_DEFAULTS,
  SAMPLING_SETTING_KEYS,
  SCALAR_SETTING_KEYS,
  settingValueSchemas,
  type ModelIdentity,
  type ScalarSettingKey,
  type SettingLayer,
  type SettingValues,
} from "@/lib/chat-settings/catalog"

const variableNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)

const scalarShape = Object.fromEntries(
  SCALAR_SETTING_KEYS.map((key) => [key, settingValueSchemas[key].optional()])
) as {
  [K in ScalarSettingKey]: z.ZodOptional<(typeof settingValueSchemas)[K]>
}

const variablesSchema = z
  .record(variableNameSchema, promptVariableValueSchema)
  .refine(
    (value) => Object.keys(value).length <= MAX_COLLECTION,
    "Too many variables"
  )

export const settingValuesSchema = z
  .object({
    ...scalarShape,
    variables: variablesSchema.optional(),
  })
  .strict()

export type ModelConfig = {
  providerId?: string
  model?: string
  reasoning?: SettingValues["reasoning"]
  contextScanDepth?: SettingValues["contextScanDepth"]
  temperature?: number
  maxOutputTokens?: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
  stopSequences?: string[]
  providerOptions?: Record<string, unknown>
  replayReasoning?: boolean
  expandMessageMacros?: boolean
}

/** Flat generation slice accepted by provider calls and the parameters dialog. */
export const modelConfigSchema = z.object({
  reasoning: settingValueSchemas.reasoning.optional(),
  providerId: z.string().optional(),
  model: z.string().optional(),
  temperature: settingValueSchemas.temperature.optional(),
  maxOutputTokens: settingValueSchemas.maxOutputTokens.optional(),
  topP: settingValueSchemas.topP.optional(),
  frequencyPenalty: settingValueSchemas.frequencyPenalty.optional(),
  presencePenalty: settingValueSchemas.presencePenalty.optional(),
  stopSequences: settingValueSchemas.stopSequences.optional(),
  providerOptions: settingValueSchemas.providerOptions.optional(),
  replayReasoning: settingValueSchemas.replayReasoning.optional(),
  expandMessageMacros: settingValueSchemas.expandMessageMacros.optional(),
  contextScanDepth: settingValueSchemas.contextScanDepth.optional(),
})

export function parseSettingValues(
  json: string | null | undefined
): SettingValues {
  const parsed = parseJson<unknown>(json ?? "{}", {})
  const result = settingValuesSchema.safeParse(parsed)
  return result.success ? result.data : {}
}

export function settingValuesToJson(values: SettingValues): string {
  return JSON.stringify(settingValuesSchema.parse(stripLayer(values, "chat")))
}

export function parseUserSettingValues(
  json: string | null | undefined
): SettingValues {
  const values = parseSettingValues(json)
  return stripLayer(values, "user")
}

export function userSettingValuesToJson(values: SettingValues): string {
  return JSON.stringify(settingValuesSchema.parse(stripLayer(values, "user")))
}

/** Drop keys the layer is not allowed to persist. */
function stripLayer(values: SettingValues, layer: SettingLayer): SettingValues {
  const next: SettingValues = {}
  for (const key of SCALAR_SETTING_KEYS) {
    if (!layerCanPersist(key, layer)) continue
    if (values[key] !== undefined) {
      assign(next, key, values[key])
    }
  }
  if (values.variables && Object.keys(values.variables).length) {
    next.variables = { ...values.variables }
  }
  return next
}

function assign<K extends ScalarSettingKey>(
  target: SettingValues,
  key: K,
  value: SettingValues[K]
) {
  target[key] = value
}

export function toModelConfig(values: SettingValues): ModelConfig {
  const config: ModelConfig = {}
  const identity = values.model
  if (identity?.providerId) config.providerId = identity.providerId
  if (identity?.model) config.model = identity.model
  if (values.reasoning) config.reasoning = { ...values.reasoning }
  for (const key of SAMPLING_SETTING_KEYS) {
    const value = values[key]
    if (value === undefined) continue
    if (key === "stopSequences" && Array.isArray(value)) {
      config.stopSequences = [...value]
      continue
    }
    if (
      key === "providerOptions" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      config.providerOptions = { ...(value as Record<string, unknown>) }
      continue
    }
    ;(config as Record<string, unknown>)[key] = value
  }
  return config
}

/** Present generation keys only. Empty collections remain explicit values. */
export function modelConfigToSettingValues(config: ModelConfig): SettingValues {
  const values: SettingValues = {}
  const identity: ModelIdentity = {}
  if (config.providerId) identity.providerId = config.providerId
  if (config.model) identity.model = config.model
  if (identity.providerId || identity.model) values.model = identity
  if (config.reasoning && Object.keys(config.reasoning).length) {
    values.reasoning = { ...config.reasoning }
  }
  for (const key of SAMPLING_SETTING_KEYS) {
    const value = config[key]
    if (value === undefined) continue
    assign(values, key, value as SettingValues[typeof key])
  }
  return values
}

export function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

/**
 * Generation keys where `desired` differs from the inherited baseline.
 * Matching keys are omitted so the chat keeps inheriting them.
 */
export function generationOverrides(
  desired: ModelConfig,
  inherited: ModelConfig
): SettingValues {
  const want = modelConfigToSettingValues(desired)
  const base = modelConfigToSettingValues(inherited)
  const next: SettingValues = {}
  for (const key of GENERATION_SETTING_KEYS) {
    if (want[key] === undefined) continue
    if (valuesEqual(want[key], base[key])) continue
    assign(next, key, want[key])
  }
  return next
}

/** Replace the stored generation slice. Other keys (stack, variables) stay. */
export function replaceGenerationSlice(
  stored: SettingValues,
  generation: SettingValues
): SettingValues {
  const next: SettingValues = { ...stored }
  if (stored.variables) next.variables = { ...stored.variables }
  for (const key of GENERATION_SETTING_KEYS) delete next[key]
  for (const key of GENERATION_SETTING_KEYS) {
    if (generation[key] !== undefined) assign(next, key, generation[key])
  }
  return next
}

export function seededUserDefaults(promptStackId: string): SettingValues {
  return {
    ...PRODUCT_DEFAULTS,
    promptStack: promptStackId,
  }
}

export function userPromptStackId(values: SettingValues): string | null {
  return typeof values.promptStack === "string" ? values.promptStack : null
}
