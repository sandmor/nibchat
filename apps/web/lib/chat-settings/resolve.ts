import {
  GENERATION_SETTING_KEYS,
  PRODUCT_DEFAULTS,
  SCALAR_SETTING_KEYS,
  type GenerationSettingKey,
  type PromptVariableValue,
  type SamplingSettingKey,
  type ScalarSettingKey,
  type SettingValues,
} from "@/lib/chat-settings/catalog"
import { toModelConfig, type ModelConfig } from "@/lib/chat-settings/values"
import {
  applySpaceBooks,
  applySpaceRules,
  compositionResult,
  emptyComposition,
  type ResolvedSpaceRule,
  type SpaceResolutionDecision,
  type SpaceUnresolvedReference,
} from "@/lib/spaces/composition"
import { definedSettingKeys } from "@/lib/spaces/settings"
import { spaceChain, spacesById, type SpaceRecord } from "@/lib/spaces/tree"
import type { SpaceLockSource } from "@/lib/spaces/types"

export type SettingOrigin =
  | { layer: "product" }
  | { layer: "user" }
  | { layer: "chat" }
  | { layer: "space"; space: SpaceLockSource }

export type SettingLocks = {
  promptStack?: SpaceLockSource
  chatTemplate?: SpaceLockSource
  model?: SpaceLockSource
  reasoning?: SpaceLockSource
  variables: Record<string, SpaceLockSource>
} & Partial<Record<SamplingSettingKey, SpaceLockSource>>

export type SettingSources = Partial<
  Record<ScalarSettingKey, SettingOrigin>
> & {
  variables: Record<string, SettingOrigin>
}

export type ResolvedSettings = {
  effective: {
    promptStackId: string | null
    chatTemplateId: string | null
    variables: Record<string, PromptVariableValue>
    model: ModelConfig
    values: SettingValues
    contextBookIds: string[]
    rules: ResolvedSpaceRule[]
    contextEntryDecisions: Record<string, Record<string, "disable" | "restore">>
  }
  locks: SettingLocks
  sources: SettingSources
  chain: SpaceRecord[]
  decisions: SpaceResolutionDecision[]
  unresolved: SpaceUnresolvedReference[]
}

type Winner = {
  value: unknown
  origin: SettingOrigin
  lock?: SpaceLockSource
}

function hasKey(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function copySetting(key: ScalarSettingKey, value: unknown): unknown {
  if (value == null || typeof value !== "object") return value
  if (key === "stopSequences" && Array.isArray(value)) return [...value]
  if (Array.isArray(value)) return [...value]
  return { ...(value as Record<string, unknown>) }
}

function resolveSlot(
  key: ScalarSettingKey,
  chain: readonly SpaceRecord[],
  user: SettingValues,
  chat: SettingValues,
  product: SettingValues
): Winner | undefined {
  let spaceHit: {
    mode: "default" | "require"
    value: unknown
    space: SpaceLockSource
  } | null = null
  for (const space of chain) {
    const policy = space.settings[key]
    if (!policy) continue
    if (policy.mode === "release") {
      spaceHit = null
      continue
    }
    spaceHit = {
      mode: policy.mode,
      value: policy.value,
      space: { spaceId: space.id, spaceName: space.name },
    }
  }
  if (spaceHit?.mode === "require") {
    return {
      value: spaceHit.value,
      origin: { layer: "space", space: spaceHit.space },
      lock: spaceHit.space,
    }
  }
  if (hasKey(chat, key)) {
    return { value: chat[key], origin: { layer: "chat" } }
  }
  if (spaceHit?.mode === "default") {
    return {
      value: spaceHit.value,
      origin: { layer: "space", space: spaceHit.space },
    }
  }
  if (hasKey(user, key)) {
    return { value: user[key], origin: { layer: "user" } }
  }
  if (hasKey(product, key)) {
    return { value: product[key], origin: { layer: "product" } }
  }
  return undefined
}

function resolveVariable(
  name: string,
  chain: readonly SpaceRecord[],
  user: SettingValues,
  chat: SettingValues
): Winner | undefined {
  let spaceHit: {
    mode: "default" | "require"
    value: PromptVariableValue
    space: SpaceLockSource
  } | null = null
  for (const space of chain) {
    const policy = space.settings.variables?.[name]
    if (!policy) continue
    if (policy.mode === "release") {
      spaceHit = null
      continue
    }
    spaceHit = {
      mode: policy.mode,
      value: policy.value,
      space: { spaceId: space.id, spaceName: space.name },
    }
  }
  if (spaceHit?.mode === "require") {
    return {
      value: spaceHit.value,
      origin: { layer: "space", space: spaceHit.space },
      lock: spaceHit.space,
    }
  }
  if (chat.variables && hasKey(chat.variables, name)) {
    return { value: chat.variables[name], origin: { layer: "chat" } }
  }
  if (spaceHit?.mode === "default") {
    return {
      value: spaceHit.value,
      origin: { layer: "space", space: spaceHit.space },
    }
  }
  if (user.variables && hasKey(user.variables, name)) {
    return { value: user.variables[name], origin: { layer: "user" } }
  }
  return undefined
}

function variableNames(
  chain: readonly SpaceRecord[],
  user: SettingValues,
  chat: SettingValues
): string[] {
  const names = new Set<string>([
    ...Object.keys(user.variables ?? {}),
    ...Object.keys(chat.variables ?? {}),
  ])
  for (const space of chain) {
    for (const name of Object.keys(space.settings.variables ?? {})) {
      names.add(name)
    }
  }
  return [...names]
}

function emptyLocks(): SettingLocks {
  return { variables: {} }
}

/**
 * Precedence per key: innermost require, then chat explicit, then innermost
 * space default, then user, then product. `release` drops ancestor space
 * policy for that key.
 */
export function resolveSettings(input: {
  product?: SettingValues
  user?: SettingValues
  chat?: SettingValues
  spaceId?: string | null
  spaces: readonly SpaceRecord[]
  contextBookIds?: readonly string[]
}): ResolvedSettings {
  const product = input.product ?? PRODUCT_DEFAULTS
  const user = input.user ?? {}
  const chat = input.chat ?? {}
  const chain = spaceChain(input.spaceId, spacesById(input.spaces))
  const locks = emptyLocks()
  const sources: SettingSources = { variables: {} }
  const values: SettingValues = {}
  const composition = emptyComposition()

  for (const space of chain) {
    const source: SpaceLockSource = { spaceId: space.id, spaceName: space.name }
    applySpaceBooks(composition, source, space.settings.books)
    applySpaceRules(composition, source, space.settings.rules)
    for (const key of definedSettingKeys(space.settings)) {
      const policy = space.settings[key]
      if (!policy) continue
      composition.decisions.push({
        kind: "setting",
        key,
        action: policy.mode,
        source,
      })
    }
    for (const [name, policy] of Object.entries(
      space.settings.variables ?? {}
    )) {
      composition.decisions.push({
        kind: "setting",
        key: `variable:${name}`,
        action: policy.mode,
        source,
      })
    }
  }

  for (const key of SCALAR_SETTING_KEYS) {
    const winner = resolveSlot(key, chain, user, chat, product)
    if (!winner) continue
    const value = copySetting(key, winner.value)
    Object.assign(values, { [key]: value })
    sources[key] = winner.origin
    if (winner.lock) locks[key] = winner.lock
  }

  const variables: Record<string, PromptVariableValue> = {}
  for (const name of variableNames(chain, user, chat)) {
    const winner = resolveVariable(name, chain, user, chat)
    if (!winner || winner.value === undefined) continue
    variables[name] = winner.value as PromptVariableValue
    sources.variables[name] = winner.origin
    if (winner.lock) locks.variables[name] = winner.lock
  }
  if (Object.keys(variables).length) values.variables = { ...variables }

  const composed = compositionResult(composition, input.contextBookIds ?? [])
  const promptStack = values.promptStack
  const chatTemplate = values.chatTemplate

  return {
    effective: {
      promptStackId: typeof promptStack === "string" ? promptStack : null,
      chatTemplateId: typeof chatTemplate === "string" ? chatTemplate : null,
      variables,
      model: toModelConfig(values),
      values,
      contextBookIds: composed.contextBookIds,
      rules: composed.rules,
      contextEntryDecisions: composed.contextEntryDecisions,
    },
    locks,
    sources,
    chain,
    decisions: composition.decisions,
    unresolved: composition.unresolved,
  }
}

/** Drop variable locks that are not declared on the effective prompt stack. */
export function bindVariableLocksToStack(
  locks: SettingLocks,
  declaredNames: readonly string[]
): SettingLocks {
  const allowed = new Set(declaredNames)
  const variables: Record<string, SpaceLockSource> = {}
  for (const [name, source] of Object.entries(locks.variables)) {
    if (allowed.has(name)) variables[name] = source
  }
  return { ...locks, variables }
}

function lockedGenerationKeys(locks: SettingLocks): Set<GenerationSettingKey> {
  const keys = new Set<GenerationSettingKey>()
  for (const key of GENERATION_SETTING_KEYS) {
    if (locks[key]) keys.add(key)
  }
  return keys
}

/** Drop overrides a space require already owns. */
export function withoutLockedSettings(
  values: SettingValues,
  locks: SettingLocks
): SettingValues {
  const next: SettingValues = { ...values }
  if (values.variables) next.variables = { ...values.variables }
  if (locks.promptStack) delete next.promptStack
  if (locks.chatTemplate) delete next.chatTemplate
  for (const key of lockedGenerationKeys(locks)) delete next[key]
  if (next.variables) {
    for (const name of Object.keys(locks.variables)) delete next.variables[name]
    if (Object.keys(next.variables).length === 0) delete next.variables
  }
  return next
}
