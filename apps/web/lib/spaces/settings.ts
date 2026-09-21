import { z } from "zod"
import { parseJson } from "@/lib/domain"
import { MAX_COLLECTION } from "@/lib/limits"
import {
  SCALAR_SETTING_KEYS,
  settingLockable,
  settingValueSchemas,
  type ScalarSettingKey,
} from "@/lib/chat-settings/catalog"
import { policyModeSchema, type PolicyMode } from "@/lib/chat-settings/policy"
import { promptVariableValueSchema } from "@/lib/prompt-stack"
import { spaceBooksSchema, spaceRulesSchema } from "@/lib/spaces/composition"

const variableNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)

function optionalPolicy<K extends ScalarSettingKey>(key: K) {
  return z
    .object({
      mode: policyModeSchema,
      value: settingValueSchemas[key],
    })
    .optional()
}

const spaceSettingsShape = z.object({
  promptStack: optionalPolicy("promptStack"),
  chatTemplate: optionalPolicy("chatTemplate"),
  model: optionalPolicy("model"),
  reasoning: optionalPolicy("reasoning"),
  contextScanDepth: optionalPolicy("contextScanDepth"),
  temperature: optionalPolicy("temperature"),
  maxOutputTokens: optionalPolicy("maxOutputTokens"),
  topP: optionalPolicy("topP"),
  frequencyPenalty: optionalPolicy("frequencyPenalty"),
  presencePenalty: optionalPolicy("presencePenalty"),
  stopSequences: optionalPolicy("stopSequences"),
  providerOptions: optionalPolicy("providerOptions"),
  replayReasoning: optionalPolicy("replayReasoning"),
  expandMessageMacros: optionalPolicy("expandMessageMacros"),
  variables: z
    .record(
      variableNameSchema,
      z.object({
        mode: policyModeSchema,
        value: promptVariableValueSchema,
      })
    )
    .refine(
      (value) => Object.keys(value).length <= MAX_COLLECTION,
      "Too many variables"
    )
    .optional(),
  books: spaceBooksSchema.optional(),
  rules: spaceRulesSchema.optional(),
})

/** Reject unknown keys on write. Reads strip unknown keys and keep known slots. */
export const spaceSettingsSchema = spaceSettingsShape.strict()

export type SpaceSettings = z.infer<typeof spaceSettingsSchema>
export type SpacePolicyMode = PolicyMode

export function parseSpaceSettings(
  json: string | null | undefined
): SpaceSettings {
  const parsed = parseJson<unknown>(json ?? "{}", {})
  const result = spaceSettingsShape.safeParse(parsed)
  return result.success ? result.data : {}
}

export function spaceSettingsToJson(settings: SpaceSettings): string {
  const parsed = spaceSettingsSchema.parse(settings)
  assertSpaceSettingsLocks(parsed)
  return JSON.stringify(parsed)
}

/** Enabled slots that would break generation cannot be saved. */
export function assertSpaceSettingsLocks(settings: SpaceSettings) {
  for (const key of SCALAR_SETTING_KEYS) {
    const policy = settings[key]
    if (!policy || policy.mode === "release") continue
    const lock = settingLockable(key, policy.value)
    if (!lock.ok) throw new Error(lock.message)
  }
}

/** Drop a stack slot that points at `stackId`. Unrelated slots stay. */
export function omitPromptStackRef(
  settings: SpaceSettings,
  stackId: string
): SpaceSettings {
  if (settings.promptStack?.value !== stackId) return settings
  const next = { ...settings }
  delete next.promptStack
  return next
}

/** Drop a model slot that points at `providerId`. Unrelated slots stay. */
export function omitModelProviderRef(
  settings: SpaceSettings,
  providerId: string
): SpaceSettings {
  if (settings.model?.value.providerId !== providerId) return settings
  const next = { ...settings }
  delete next.model
  return next
}

export function definedSettingKeys(
  settings: SpaceSettings
): ScalarSettingKey[] {
  return SCALAR_SETTING_KEYS.filter((key) => settings[key] !== undefined)
}

export function spacePolicyImpact(settings: SpaceSettings) {
  const entryPolicies = Object.values(settings.books?.entries ?? {}).reduce(
    (count, entries) => count + Object.keys(entries).length,
    0
  )
  return {
    settings: definedSettingKeys(settings),
    variables: Object.keys(settings.variables ?? {}).length,
    books:
      Object.keys(settings.books?.decisions ?? {}).length +
      entryPolicies +
      (settings.books?.reset ? 1 : 0),
    rules: settings.rules?.length ?? 0,
  }
}
