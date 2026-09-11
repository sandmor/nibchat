import { z } from "zod"
import { parseJson } from "@/lib/domain"
import {
  MAX_COLLECTION,
  MAX_DESCRIPTION,
  MAX_NAME,
  MAX_SPACE_DEPTH,
} from "@/lib/limits"
import { promptVariableValueSchema } from "@/lib/prompt-stack"
import type { ModelConfig } from "@/lib/providers"
import { reasoningPreferencesSchema } from "@/lib/reasoning"
import type { SpaceRow } from "@/lib/types"

const variableNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)

function slotSchema<T extends z.ZodType>(value: T) {
  return z.object({
    enabled: z.boolean(),
    value,
  })
}

const modelIdentitySchema = z.object({
  providerId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
})

export const SPACE_SAMPLING_KEYS = [
  "temperature",
  "maxOutputTokens",
  "topP",
  "frequencyPenalty",
  "presencePenalty",
  "stopSequences",
  "providerOptions",
  "replayReasoning",
] as const

export type SpaceSamplingKey = (typeof SPACE_SAMPLING_KEYS)[number]

const spaceSettingsShape = z.object({
  promptStack: slotSchema(z.string().min(1)).optional(),
  variables: z
    .record(variableNameSchema, slotSchema(promptVariableValueSchema))
    .refine(
      (value) => Object.keys(value).length <= MAX_COLLECTION,
      "Too many variables"
    )
    .optional(),
  model: slotSchema(modelIdentitySchema).optional(),
  reasoning: slotSchema(reasoningPreferencesSchema).optional(),
  temperature: slotSchema(z.number()).optional(),
  maxOutputTokens: slotSchema(z.number()).optional(),
  topP: slotSchema(z.number()).optional(),
  frequencyPenalty: slotSchema(z.number()).optional(),
  presencePenalty: slotSchema(z.number()).optional(),
  stopSequences: slotSchema(z.array(z.string())).optional(),
  providerOptions: slotSchema(z.record(z.string(), z.unknown())).optional(),
  replayReasoning: slotSchema(z.boolean()).optional(),
})

/** Reject unknown keys on write. Reads strip unknown keys and keep known slots. */
export const spaceSettingsSchema = spaceSettingsShape.strict()

export type SpaceSettings = z.infer<typeof spaceSettingsSchema>
export type SpaceSettingSlot<T> = { enabled: boolean; value: T }

export type SpaceLockSource = { spaceId: string; spaceName: string }

export type ChatSettingLocks = {
  promptStack?: SpaceLockSource
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
}

export type ResolvedChatSettings = {
  effective: {
    promptStackId: string | null
    variables: Record<string, unknown>
    model: ModelConfig
  }
  locks: ChatSettingLocks
  chain: SpaceRecord[]
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
    settings.model?.enabled &&
    !spaceModelIdentityComplete(settings.model.value)
  ) {
    throw new Error("Lock a model only after choosing a provider and model")
  }
  if (
    settings.maxOutputTokens?.enabled &&
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

function spaceSubtreeIds(
  spaceId: string,
  spaces: readonly SpaceRecord[]
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

function applyEnabledSlot<T>(
  slot: SpaceSettingSlot<T> | undefined,
  source: SpaceLockSource,
  apply: (value: T) => void,
  lock: (source: SpaceLockSource) => void
) {
  if (!slot?.enabled) return
  apply(slot.value)
  lock(source)
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
  const variables: Record<string, unknown> = { ...input.chat.variables }

  for (const space of chain) {
    const source: SpaceLockSource = { spaceId: space.id, spaceName: space.name }
    const settings = space.settings
    applyEnabledSlot(
      settings.promptStack,
      source,
      (value) => {
        promptStackId = value
      },
      (lockSource) => {
        locks.promptStack = lockSource
      }
    )
    for (const [name, slot] of Object.entries(settings.variables ?? {})) {
      applyEnabledSlot(
        slot,
        source,
        (value) => {
          variables[name] = value
        },
        (lockSource) => {
          locks.variables[name] = lockSource
        }
      )
    }
    applyEnabledSlot(
      settings.model,
      source,
      (value) => {
        model.providerId = value.providerId
        model.model = value.model
      },
      (lockSource) => {
        locks.model = lockSource
      }
    )
    applyEnabledSlot(
      settings.reasoning,
      source,
      (value) => {
        model.reasoning = value
      },
      (lockSource) => {
        locks.reasoning = lockSource
      }
    )
    for (const key of SPACE_SAMPLING_KEYS) {
      applyEnabledSlot(
        settings[key] as SpaceSettingSlot<ModelConfig[typeof key]> | undefined,
        source,
        (value) => {
          if (value === undefined) delete model[key]
          else (model as Record<string, unknown>)[key] = value
        },
        (lockSource) => {
          locks[key] = lockSource
        }
      )
    }
  }

  return {
    effective: { promptStackId, variables, model },
    locks,
    chain,
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
}

export function definedSettingKeys(settings: SpaceSettings): string[] {
  const keys: string[] = []
  if (settings.promptStack) keys.push("promptStack")
  if (settings.model) keys.push("model")
  if (settings.reasoning) keys.push("reasoning")
  for (const key of SPACE_SAMPLING_KEYS) {
    if (settings[key]) keys.push(key)
  }
  return keys
}
