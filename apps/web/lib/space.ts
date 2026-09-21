import { z } from "zod"
import { parseJson } from "@/lib/domain"
import {
  MAX_COLLECTION,
  MAX_DESCRIPTION,
  MAX_NAME,
  MAX_PROMPT_CHARS,
  MAX_SPACE_DEPTH,
} from "@/lib/limits"
import { promptVariableValueSchema } from "@/lib/prompt-stack"
import type { ModelConfig } from "@/lib/providers"
import { reasoningPreferencesSchema } from "@/lib/reasoning"
import { scanDepthSchema } from "@/lib/chat-settings"
import type { SpaceRow } from "@/lib/types"

const variableNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)

const policyModeSchema = z.enum(["default", "require", "release"])

function policySchema<T extends z.ZodType>(value: T) {
  return z.object({
    mode: policyModeSchema,
    value,
  })
}

function boundedRecord<T extends z.ZodType>(value: T) {
  return z
    .record(z.string().min(1), value)
    .refine((entries) => Object.keys(entries).length <= MAX_COLLECTION)
}

const modelIdentitySchema = z.object({
  providerId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
})

export const SPACE_SAMPLING_KEYS = [
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
] as const

export type SpaceSamplingKey = (typeof SPACE_SAMPLING_KEYS)[number]

const spaceSettingsShape = z.object({
  contextScanDepth: policySchema(scanDepthSchema).optional(),
  books: z
    .object({
      reset: z.boolean().default(false),
      decisions: boundedRecord(z.enum(["include", "exclude"])),
      entries: boundedRecord(
        boundedRecord(z.enum(["disable", "restore"]))
      ).optional(),
    })
    .optional(),
  promptStack: policySchema(z.string().min(1)).optional(),
  chatTemplate: policySchema(z.string().nullable()).optional(),
  variables: z
    .record(variableNameSchema, policySchema(promptVariableValueSchema))
    .refine(
      (value) => Object.keys(value).length <= MAX_COLLECTION,
      "Too many variables"
    )
    .optional(),
  model: policySchema(modelIdentitySchema).optional(),
  reasoning: policySchema(reasoningPreferencesSchema).optional(),
  temperature: policySchema(z.number()).optional(),
  maxOutputTokens: policySchema(z.number()).optional(),
  topP: policySchema(z.number()).optional(),
  frequencyPenalty: policySchema(z.number()).optional(),
  presencePenalty: policySchema(z.number()).optional(),
  stopSequences: policySchema(z.array(z.string())).optional(),
  providerOptions: policySchema(z.record(z.string(), z.unknown())).optional(),
  replayReasoning: policySchema(z.boolean()).optional(),
  expandMessageMacros: policySchema(z.boolean()).optional(),
  rules: z
    .array(
      z.object({
        id: z.string().min(1),
        operation: z.enum(["define", "replace", "disable", "restore"]),
        title: z.string().trim().min(1).max(MAX_NAME).optional(),
        content: z.string().max(MAX_PROMPT_CHARS).optional(),
      })
    )
    .max(MAX_COLLECTION)
    .optional(),
})

/** Reject unknown keys on write. Reads strip unknown keys and keep known slots. */
export const spaceSettingsSchema = spaceSettingsShape.strict()

export type SpaceSettings = z.infer<typeof spaceSettingsSchema>
export type SpacePolicyMode = z.infer<typeof policyModeSchema>
export type SpaceSettingPolicy<T> = { mode: SpacePolicyMode; value: T }
export type SpaceRule = NonNullable<SpaceSettings["rules"]>[number]

export type SpaceLockSource = { spaceId: string; spaceName: string }

export type ChatSettingLocks = {
  promptStack?: SpaceLockSource
  chatTemplate?: SpaceLockSource
  variables: Record<string, SpaceLockSource>
  model?: SpaceLockSource
  reasoning?: SpaceLockSource
} & Partial<Record<SpaceSamplingKey, SpaceLockSource>>

export type SpaceRecord = {
  id: string
  parent_id: string | null
  name: string
  settings: SpaceSettings
}

export type ChatSettingsSource = {
  spaceId: string | null
  promptStackId: string | null
  variables: Record<string, unknown>
  model: ModelConfig
  contextBookIds?: string[]
  explicit?: ChatSpaceOverrides
}

export const chatSpaceOverridesSchema = z.object({
  promptStack: z.boolean().optional(),
  model: z.array(z.string()).max(MAX_COLLECTION).optional(),
  variables: z.array(z.string()).max(MAX_COLLECTION).optional(),
})

export type ChatSpaceOverrides = z.infer<typeof chatSpaceOverridesSchema>

export function parseChatSpaceOverrides(
  json: string | null | undefined
): ChatSpaceOverrides {
  const parsed = parseJson<unknown>(json ?? "{}", {})
  const result = chatSpaceOverridesSchema.safeParse(parsed)
  return result.success ? result.data : {}
}

export function chatSpaceOverridesToJson(value: ChatSpaceOverrides): string {
  return JSON.stringify(chatSpaceOverridesSchema.parse(value))
}

export type ResolvedChatSettings = {
  effective: {
    promptStackId: string | null
    chatTemplateId: string | null
    variables: Record<string, unknown>
    model: ModelConfig
    contextBookIds: string[]
    rules: ResolvedSpaceRule[]
    contextEntryDecisions: Record<string, Record<string, "disable" | "restore">>
  }
  locks: ChatSettingLocks
  chain: SpaceRecord[]
  decisions: SpaceResolutionDecision[]
  unresolved: SpaceUnresolvedReference[]
}

export type SpaceResolutionDecision = {
  kind: "setting" | "book" | "entry" | "rule"
  key: string
  action: string
  source: SpaceLockSource
}

export type SpaceUnresolvedReference = {
  kind: "rule"
  id: string
  operation: "replace" | "disable" | "restore"
  source: SpaceLockSource
}

export type ResolvedSpaceRule = {
  id: string
  title: string
  content: string
  source: SpaceLockSource
}

export function formatSpaceRules(rules: readonly ResolvedSpaceRule[]): string {
  if (!rules.length) return ""
  return [
    "<space_rules>",
    ...rules.map((rule) => `## ${rule.title}\n${rule.content.trim()}`),
    "</space_rules>",
  ].join("\n\n")
}

function emptyLocks(): ChatSettingLocks {
  return { variables: {} }
}

export function parseSpaceSettings(
  json: string | null | undefined
): SpaceSettings {
  const parsed = parseJson<unknown>(json ?? "{}", {})
  const result = spaceSettingsShape.safeParse(parsed)
  return result.success ? result.data : {}
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

export function spaceModelIdentityComplete(value: {
  providerId?: string
  model?: string
}): boolean {
  return Boolean(value.providerId && value.model)
}

export function spaceMaxOutputTokensLockable(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/** Enabled slots that would break generation cannot be saved. */
export function assertSpaceSettingsLocks(settings: SpaceSettings) {
  if (
    settings.model &&
    settings.model.mode !== "release" &&
    !spaceModelIdentityComplete(settings.model.value)
  ) {
    throw new Error("Lock a model only after choosing a provider and model")
  }
  if (
    settings.maxOutputTokens &&
    settings.maxOutputTokens.mode !== "release" &&
    !spaceMaxOutputTokensLockable(settings.maxOutputTokens.value)
  ) {
    throw new Error("Max output must be greater than 0 when locked")
  }
}

export function spaceSettingsToJson(settings: SpaceSettings): string {
  const parsed = spaceSettingsSchema.parse(settings)
  assertSpaceSettingsLocks(parsed)
  return JSON.stringify(parsed)
}

export function spaceFromRow(
  row: Pick<SpaceRow, "id" | "parent_id" | "name" | "settings_json">
): SpaceRecord {
  return {
    id: row.id,
    parent_id: row.parent_id,
    name: row.name,
    settings: parseSpaceSettings(row.settings_json),
  }
}

export function spacesById(
  spaces: readonly SpaceRecord[]
): Map<string, SpaceRecord> {
  return new Map(spaces.map((space) => [space.id, space]))
}

/** Root-first ancestor chain, including `spaceId`. */
export function spaceChain(
  spaceId: string | null | undefined,
  byId: Map<string, SpaceRecord>
): SpaceRecord[] {
  if (!spaceId) return []
  const chain: SpaceRecord[] = []
  const seen = new Set<string>()
  let current = byId.get(spaceId)
  while (current) {
    if (seen.has(current.id)) break
    seen.add(current.id)
    chain.unshift(current)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return chain
}

export function spaceSubtreeIds(
  spaceId: string,
  spaces: readonly { id: string; parent_id: string | null }[]
): Set<string> {
  const children = new Map<string | null, string[]>()
  for (const space of spaces) {
    const list = children.get(space.parent_id) ?? []
    list.push(space.id)
    children.set(space.parent_id, list)
  }
  const ids = new Set<string>()
  const stack = [spaceId]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (ids.has(current)) continue
    ids.add(current)
    for (const child of children.get(current) ?? []) stack.push(child)
  }
  return ids
}

/** 1 = top-level space. Missing id is 0. */
export function spaceDepth(
  spaceId: string | null | undefined,
  byId: Map<string, SpaceRecord>
): number {
  return spaceChain(spaceId, byId).length
}

/** 1 = leaf. Missing id is 0. */
export function spaceSubtreeHeight(
  spaceId: string,
  spaces: readonly SpaceRecord[]
): number {
  const children = new Map<string | null, string[]>()
  for (const space of spaces) {
    const list = children.get(space.parent_id) ?? []
    list.push(space.id)
    children.set(space.parent_id, list)
  }
  function height(id: string, seen: Set<string>): number {
    if (seen.has(id)) return 1
    seen.add(id)
    const kids = children.get(id) ?? []
    if (kids.length === 0) return 1
    return 1 + Math.max(...kids.map((kid) => height(kid, seen)))
  }
  return height(spaceId, new Set())
}

function wouldCreateCycle(
  spaceId: string,
  newParentId: string | null,
  spaces: readonly SpaceRecord[]
): boolean {
  if (!newParentId) return false
  if (newParentId === spaceId) return true
  return spaceSubtreeIds(spaceId, spaces).has(newParentId)
}

export function assertSpaceMoveAllowed(
  spaceId: string,
  newParentId: string | null,
  spaces: readonly SpaceRecord[]
) {
  if (wouldCreateCycle(spaceId, newParentId, spaces)) {
    throw new Error("A space cannot contain itself")
  }
  const byId = spacesById(spaces)
  const parentDepth = newParentId ? spaceDepth(newParentId, byId) : 0
  const height = spaceSubtreeHeight(spaceId, spaces)
  if (parentDepth + height > MAX_SPACE_DEPTH) {
    throw new Error(`Spaces can nest at most ${MAX_SPACE_DEPTH} levels`)
  }
}

function applyPolicy<T>(
  policy: SpaceSettingPolicy<T> | undefined,
  source: SpaceLockSource,
  apply: (value: T) => void,
  lock: (source: SpaceLockSource | undefined) => void,
  release: () => void,
  hasChatValue: boolean
) {
  if (!policy) return
  if (policy.mode === "release") {
    release()
    lock(undefined)
    return
  }
  if (policy.mode === "require" || !hasChatValue) apply(policy.value)
  else release()
  if (policy.mode === "require") lock(source)
  else lock(undefined)
}

export function resolveChatSettings(input: {
  chat: ChatSettingsSource
  spaces: readonly SpaceRecord[]
}): ResolvedChatSettings {
  const byId = spacesById(input.spaces)
  const chain = spaceChain(input.chat.spaceId, byId)
  const locks = emptyLocks()
  const model: ModelConfig = { ...input.chat.model }
  if (input.chat.model.reasoning) {
    model.reasoning = { ...input.chat.model.reasoning }
  }
  if (input.chat.model.stopSequences) {
    model.stopSequences = [...input.chat.model.stopSequences]
  }
  if (input.chat.model.providerOptions) {
    model.providerOptions = { ...input.chat.model.providerOptions }
  }
  let promptStackId = input.chat.promptStackId
  let chatTemplateId: string | null = null
  const variables: Record<string, unknown> = { ...input.chat.variables }
  const contextBookIds: string[] = []
  const contextBookState = new Map<string, boolean>()
  const rules = new Map<string, ResolvedSpaceRule>()
  const disabledRules = new Set<string>()
  const explicitModel = input.chat.explicit
    ? new Set(input.chat.explicit.model ?? [])
    : null
  const explicitVariables = input.chat.explicit
    ? new Set(input.chat.explicit.variables ?? [])
    : null
  const contextEntryDecisions: Record<
    string,
    Record<string, "disable" | "restore">
  > = {}
  const decisions: SpaceResolutionDecision[] = []
  const unresolved: SpaceUnresolvedReference[] = []

  for (const space of chain) {
    const source: SpaceLockSource = { spaceId: space.id, spaceName: space.name }
    const settings = space.settings
    if (settings.books?.reset) {
      contextBookState.clear()
      decisions.push({ kind: "book", key: "*", action: "reset", source })
    }
    for (const [bookId, decision] of Object.entries(
      settings.books?.decisions ?? {}
    )) {
      contextBookState.set(bookId, decision === "include")
      decisions.push({ kind: "book", key: bookId, action: decision, source })
    }
    for (const [bookId, entries] of Object.entries(
      settings.books?.entries ?? {}
    )) {
      contextEntryDecisions[bookId] = {
        ...contextEntryDecisions[bookId],
        ...entries,
      }
      for (const [entryId, operation] of Object.entries(entries)) {
        decisions.push({
          kind: "entry",
          key: `${bookId}:${entryId}`,
          action: operation,
          source,
        })
      }
    }
    for (const rule of settings.rules ?? []) {
      if (
        rule.operation !== "define" &&
        !rules.has(rule.id) &&
        !disabledRules.has(rule.id)
      ) {
        unresolved.push({
          kind: "rule",
          id: rule.id,
          operation: rule.operation,
          source,
        })
      }
      decisions.push({
        kind: "rule",
        key: rule.id,
        action: rule.operation,
        source,
      })
      if (rule.operation === "disable") {
        disabledRules.add(rule.id)
        continue
      }
      if (rule.operation === "restore") {
        disabledRules.delete(rule.id)
        continue
      }
      if (!rule.title || !rule.content) continue
      rules.set(rule.id, {
        id: rule.id,
        title: rule.title,
        content: rule.content,
        source,
      })
      disabledRules.delete(rule.id)
    }
    for (const key of definedSettingKeys(settings)) {
      const policy = settings[key as keyof SpaceSettings] as
        | { mode?: string }
        | undefined
      if (policy?.mode)
        decisions.push({
          kind: "setting",
          key,
          action: policy.mode,
          source,
        })
    }
    for (const [name, policy] of Object.entries(settings.variables ?? {})) {
      decisions.push({
        kind: "setting",
        key: `variable:${name}`,
        action: policy.mode,
        source,
      })
    }
    applyPolicy(
      settings.promptStack,
      source,
      (value) => {
        promptStackId = value
      },
      (lockSource) => {
        locks.promptStack = lockSource
      },
      () => {
        promptStackId = input.chat.promptStackId
      },
      input.chat.explicit
        ? Boolean(input.chat.explicit.promptStack)
        : input.chat.promptStackId !== null
    )
    applyPolicy(
      settings.chatTemplate,
      source,
      (value) => {
        chatTemplateId = value
      },
      (lockSource) => {
        if (lockSource) locks.chatTemplate = lockSource
        else delete locks.chatTemplate
      },
      () => {
        chatTemplateId = null
      },
      false
    )
    for (const [name, slot] of Object.entries(settings.variables ?? {})) {
      applyPolicy(
        slot,
        source,
        (value) => {
          variables[name] = value
        },
        (lockSource) => {
          if (lockSource) locks.variables[name] = lockSource
          else delete locks.variables[name]
        },
        () => {
          if (input.chat.variables[name] === undefined) delete variables[name]
          else variables[name] = input.chat.variables[name]
        },
        explicitVariables
          ? explicitVariables.has(name)
          : input.chat.variables[name] !== undefined
      )
    }
    applyPolicy(
      settings.model,
      source,
      (value) => {
        model.providerId = value.providerId
        model.model = value.model
      },
      (lockSource) => {
        locks.model = lockSource
      },
      () => {
        model.providerId = input.chat.model.providerId
        model.model = input.chat.model.model
      },
      explicitModel
        ? explicitModel.has("providerId") || explicitModel.has("model")
        : Boolean(input.chat.model.providerId && input.chat.model.model)
    )
    applyPolicy(
      settings.reasoning,
      source,
      (value) => {
        model.reasoning = value
      },
      (lockSource) => {
        locks.reasoning = lockSource
      },
      () => {
        if (input.chat.model.reasoning === undefined) delete model.reasoning
        else model.reasoning = input.chat.model.reasoning
      },
      explicitModel
        ? explicitModel.has("reasoning")
        : input.chat.model.reasoning !== undefined
    )
    for (const key of SPACE_SAMPLING_KEYS) {
      applyPolicy(
        settings[key] as
          | SpaceSettingPolicy<ModelConfig[typeof key]>
          | undefined,
        source,
        (value) => {
          if (value === undefined) delete model[key]
          else (model as Record<string, unknown>)[key] = value
        },
        (lockSource) => {
          locks[key] = lockSource
        },
        () => {
          const value = input.chat.model[key]
          if (value === undefined) delete model[key]
          else (model as Record<string, unknown>)[key] = value
        },
        explicitModel
          ? explicitModel.has(key)
          : input.chat.model[key] !== undefined
      )
    }
  }

  for (const [bookId, included] of contextBookState) {
    if (included) contextBookIds.push(bookId)
  }
  const effectiveRules = [...rules.values()].filter(
    (rule) => !disabledRules.has(rule.id)
  )

  return {
    effective: {
      promptStackId,
      chatTemplateId,
      variables,
      model,
      contextBookIds: [
        ...contextBookIds,
        ...(input.chat.contextBookIds ?? []).filter(
          (id) => !contextBookState.has(id)
        ),
      ],
      rules: effectiveRules,
      contextEntryDecisions,
    },
    locks,
    chain,
    decisions,
    unresolved,
  }
}

/** Drop variable locks that are not declared on the effective prompt stack. */
export function bindVariableLocksToStack(
  locks: ChatSettingLocks,
  declaredNames: readonly string[]
): ChatSettingLocks {
  const allowed = new Set(declaredNames)
  const variables: Record<string, SpaceLockSource> = {}
  for (const [name, source] of Object.entries(locks.variables)) {
    if (allowed.has(name)) variables[name] = source
  }
  return { ...locks, variables }
}

export function mergeUnlockedModelConfig(
  stored: ModelConfig,
  incoming: ModelConfig,
  locks: ChatSettingLocks
): ModelConfig {
  const next: ModelConfig = { ...incoming }
  if (locks.model) {
    next.providerId = stored.providerId
    next.model = stored.model
  }
  if (locks.reasoning) next.reasoning = stored.reasoning
  for (const key of SPACE_SAMPLING_KEYS) {
    if (!locks[key]) continue
    const value = stored[key]
    if (value === undefined) delete next[key]
    else (next as Record<string, unknown>)[key] = value
  }
  return next
}

export function mergeUnlockedVariables(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
  locks: ChatSettingLocks,
  declaredNames: readonly string[]
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...incoming }
  const allowed = new Set(declaredNames)
  for (const name of Object.keys(locks.variables)) {
    if (!allowed.has(name)) continue
    if (stored[name] === undefined) delete next[name]
    else next[name] = stored[name]
  }
  return next
}

/** Topological order so a space is inserted after its parent. */
export function orderSpacesForInsert<
  T extends { id: string; parent_id: string | null },
>(spaces: T[] | undefined): T[] {
  if (!spaces?.length) return []
  const byId = new Map(spaces.map((space) => [space.id, space]))
  if (byId.size !== spaces.length) throw new Error("Duplicate space ids")
  const ordered: T[] = []
  const seen = new Set<string>()
  function visit(id: string, stack: Set<string>) {
    if (seen.has(id)) return
    if (stack.has(id)) throw new Error("Spaces contain a cycle")
    const space = byId.get(id)
    if (!space) throw new Error(`Unknown space ${id}`)
    stack.add(id)
    if (space.parent_id) {
      if (!byId.has(space.parent_id)) {
        throw new Error(
          `Space ${id} references missing parent ${space.parent_id}`
        )
      }
      visit(space.parent_id, stack)
    }
    stack.delete(id)
    seen.add(id)
    ordered.push(space)
  }
  for (const space of spaces) visit(space.id, new Set())
  return ordered
}

export const spaceNameSchema = z.string().trim().min(1).max(MAX_NAME)
export const spaceDescriptionSchema = z.string().max(MAX_DESCRIPTION)

export const SETTING_SLOT_LABELS: Record<string, string> = {
  chatTemplate: "Chat template",
  contextScanDepth: "Context scan depth",
  promptStack: "Prompt stack",
  model: "Model",
  reasoning: "Reasoning",
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

export function definedSettingKeys(settings: SpaceSettings): string[] {
  const keys: string[] = []
  if (settings.promptStack) keys.push("promptStack")
  if (settings.chatTemplate) keys.push("chatTemplate")
  if (settings.model) keys.push("model")
  if (settings.reasoning) keys.push("reasoning")
  for (const key of SPACE_SAMPLING_KEYS) {
    if (settings[key]) keys.push(key)
  }
  return keys
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
