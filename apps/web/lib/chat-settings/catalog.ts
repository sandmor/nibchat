import { z } from "zod"
import { MAX_PROMPT_CHARS, MAX_SCAN_DEPTH } from "@/lib/limits"
import { promptVariableValueSchema } from "@/lib/prompt-stack"
import { reasoningPreferencesSchema } from "@/lib/reasoning"

/** null means the entire branch; undefined is reserved for entry inheritance. */
export const scanDepthSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_SCAN_DEPTH)
  .nullable()

export const modelIdentitySchema = z.object({
  providerId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
})

export const titleStrategySchema = z.enum(["first-message", "generate"])
export const titleInstructionsSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_PROMPT_CHARS)
export const DEFAULT_TITLE_INSTRUCTIONS =
  "Name this chat in a few words. Return only the title. No quotes, colons, or trailing punctuation."

export type ModelIdentity = z.infer<typeof modelIdentitySchema>

/**
 * Scalar setting values. Variables are a separate named map: each name is its
 * own slot, not one blob.
 */
export const settingValueSchemas = {
  titleStrategy: titleStrategySchema,
  titleModel: modelIdentitySchema,
  titleInstructions: titleInstructionsSchema,
  promptStack: z.string().min(1).nullable(),
  chatTemplate: z.string().min(1).nullable(),
  model: modelIdentitySchema,
  reasoning: reasoningPreferencesSchema,
  contextScanDepth: scanDepthSchema,
  temperature: z.number(),
  maxOutputTokens: z.number(),
  topP: z.number(),
  frequencyPenalty: z.number(),
  presencePenalty: z.number(),
  stopSequences: z.array(z.string()),
  providerOptions: z.record(z.string(), z.unknown()),
  replayReasoning: z.boolean(),
  expandMessageMacros: z.boolean(),
} as const

export type ScalarSettingKey = keyof typeof settingValueSchemas

export const SCALAR_SETTING_KEYS = Object.keys(
  settingValueSchemas
) as ScalarSettingKey[]

export type SettingLayer = "user" | "chat" | "space"

/** Which documents may persist the key. `require` is still space-only. */
export const SETTING_LAYERS: Record<ScalarSettingKey, readonly SettingLayer[]> =
  {
    titleStrategy: ["user", "chat", "space"],
    titleModel: ["user", "chat", "space"],
    titleInstructions: ["user", "chat", "space"],
    promptStack: ["user", "chat", "space"],
    chatTemplate: ["space"],
    model: ["user", "chat", "space"],
    reasoning: ["user", "chat", "space"],
    contextScanDepth: ["user", "chat", "space"],
    temperature: ["user", "chat", "space"],
    maxOutputTokens: ["user", "chat", "space"],
    topP: ["user", "chat", "space"],
    frequencyPenalty: ["user", "chat", "space"],
    presencePenalty: ["user", "chat", "space"],
    stopSequences: ["user", "chat", "space"],
    providerOptions: ["user", "chat", "space"],
    replayReasoning: ["user", "chat", "space"],
    expandMessageMacros: ["user", "chat", "space"],
  }

export const SETTING_LABELS: Record<ScalarSettingKey, string> = {
  titleStrategy: "Title strategy",
  titleModel: "Title model",
  titleInstructions: "Title instructions",
  promptStack: "Prompt stack",
  chatTemplate: "Chat template",
  model: "Model",
  reasoning: "Reasoning",
  contextScanDepth: "Context scan depth",
  temperature: "Temperature",
  maxOutputTokens: "Max output",
  topP: "Top P",
  frequencyPenalty: "Frequency penalty",
  presencePenalty: "Presence penalty",
  stopSequences: "Stop sequences",
  providerOptions: "Provider JSON",
  replayReasoning: "Replay reasoning",
  expandMessageMacros: "Message macros",
}

/** Sampling and generation flags stored beside model identity. */
export const SAMPLING_SETTING_KEYS = [
  "contextScanDepth",
  "temperature",
  "maxOutputTokens",
  "topP",
  "frequencyPenalty",
  "presencePenalty",
  "stopSequences",
  "providerOptions",
  "replayReasoning",
  "expandMessageMacros",
] as const satisfies readonly ScalarSettingKey[]

export type SamplingSettingKey = (typeof SAMPLING_SETTING_KEYS)[number]

/** Flat generation config: model identity, reasoning, and sampling. */
export const GENERATION_SETTING_KEYS = [
  "model",
  "reasoning",
  ...SAMPLING_SETTING_KEYS,
] as const satisfies readonly ScalarSettingKey[]

export type GenerationSettingKey = (typeof GENERATION_SETTING_KEYS)[number]

/** Keys a space editor can add. Chat template is space-only. */
export const ADDABLE_SETTING_KEYS = [
  "titleStrategy",
  "titleModel",
  "titleInstructions",
  "chatTemplate",
  "promptStack",
  "model",
  "reasoning",
  ...SAMPLING_SETTING_KEYS,
] as const satisfies readonly ScalarSettingKey[]

export type PromptVariableValue = z.infer<typeof promptVariableValueSchema>

export type SettingValues = {
  [K in ScalarSettingKey]?: z.infer<(typeof settingValueSchemas)[K]>
} & {
  variables?: Record<string, PromptVariableValue>
}

/** Fallback when no user, space, or chat value is present. */
export const PRODUCT_DEFAULTS = {
  contextScanDepth: 2,
  titleStrategy: "first-message",
  titleInstructions: DEFAULT_TITLE_INSTRUCTIONS,
} satisfies SettingValues

export function layerCanPersist(
  key: ScalarSettingKey,
  layer: SettingLayer
): boolean {
  return SETTING_LAYERS[key].includes(layer)
}

export function modelIdentityComplete(value: ModelIdentity): boolean {
  return Boolean(value.providerId && value.model)
}

export function maxOutputTokensLockable(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

export function settingLockable(
  key: ScalarSettingKey,
  value: unknown
): { ok: true } | { ok: false; message: string } {
  if (key === "model" || key === "titleModel") {
    const identity = modelIdentitySchema.safeParse(value)
    if (!identity.success || !modelIdentityComplete(identity.data)) {
      return {
        ok: false,
        message: "Lock a model only after choosing a provider and model",
      }
    }
  }
  if (key === "maxOutputTokens") {
    if (typeof value !== "number" || !maxOutputTokensLockable(value)) {
      return {
        ok: false,
        message: "Max output must be greater than 0 when locked",
      }
    }
  }
  return { ok: true }
}

/** Value used when a space first adds a slot. Callers may replace stack/template ids. */
export function initialSettingValue(
  key: ScalarSettingKey
): SettingValues[ScalarSettingKey] {
  switch (key) {
    case "titleStrategy":
      return "first-message"
    case "titleModel":
      return {}
    case "titleInstructions":
      return DEFAULT_TITLE_INSTRUCTIONS
    case "chatTemplate":
      return null
    case "promptStack":
      return ""
    case "model":
    case "reasoning":
      return {}
    case "contextScanDepth":
      return PRODUCT_DEFAULTS.contextScanDepth
    case "replayReasoning":
      return true
    case "expandMessageMacros":
      return false
    case "stopSequences":
      return []
    case "providerOptions":
      return {}
    default:
      return 0
  }
}
