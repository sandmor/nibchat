import { z } from "zod"
import { MAX_COLLECTION, MAX_NAME, MAX_PROMPT_CHARS } from "@/lib/limits"
import type { SpaceLockSource } from "@/lib/spaces/types"

function boundedRecord<T extends z.ZodType>(value: T) {
  return z
    .record(z.string().min(1), value)
    .refine((entries) => Object.keys(entries).length <= MAX_COLLECTION)
}

export const spaceBooksSchema = z.object({
  reset: z.boolean().default(false),
  decisions: boundedRecord(z.enum(["include", "exclude"])),
  entries: boundedRecord(
    boundedRecord(z.enum(["disable", "restore"]))
  ).optional(),
})

export const spaceRuleSchema = z.object({
  id: z.string().min(1),
  operation: z.enum(["define", "replace", "disable", "restore"]),
  title: z.string().trim().min(1).max(MAX_NAME).optional(),
  content: z.string().max(MAX_PROMPT_CHARS).optional(),
})

export const spaceRulesSchema = z.array(spaceRuleSchema).max(MAX_COLLECTION)

export type SpaceBooks = z.infer<typeof spaceBooksSchema>
export type SpaceRule = z.infer<typeof spaceRuleSchema>

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

export type CompositionAccumulator = {
  books: Map<string, boolean>
  rules: Map<string, ResolvedSpaceRule>
  disabledRules: Set<string>
  contextEntryDecisions: Record<string, Record<string, "disable" | "restore">>
  decisions: SpaceResolutionDecision[]
  unresolved: SpaceUnresolvedReference[]
}

export function emptyComposition(): CompositionAccumulator {
  return {
    books: new Map(),
    rules: new Map(),
    disabledRules: new Set(),
    contextEntryDecisions: {},
    decisions: [],
    unresolved: [],
  }
}

export function applySpaceBooks(
  state: CompositionAccumulator,
  source: SpaceLockSource,
  books: SpaceBooks | undefined
) {
  if (!books) return
  if (books.reset) {
    state.books.clear()
    state.decisions.push({ kind: "book", key: "*", action: "reset", source })
  }
  for (const [bookId, decision] of Object.entries(books.decisions ?? {})) {
    state.books.set(bookId, decision === "include")
    state.decisions.push({ kind: "book", key: bookId, action: decision, source })
  }
  for (const [bookId, entries] of Object.entries(books.entries ?? {})) {
    state.contextEntryDecisions[bookId] = {
      ...state.contextEntryDecisions[bookId],
      ...entries,
    }
    for (const [entryId, operation] of Object.entries(entries)) {
      state.decisions.push({
        kind: "entry",
        key: `${bookId}:${entryId}`,
        action: operation,
        source,
      })
    }
  }
}

export function applySpaceRules(
  state: CompositionAccumulator,
  source: SpaceLockSource,
  rules: readonly SpaceRule[] | undefined
) {
  for (const rule of rules ?? []) {
    if (
      rule.operation !== "define" &&
      !state.rules.has(rule.id) &&
      !state.disabledRules.has(rule.id)
    ) {
      state.unresolved.push({
        kind: "rule",
        id: rule.id,
        operation: rule.operation,
        source,
      })
    }
    state.decisions.push({
      kind: "rule",
      key: rule.id,
      action: rule.operation,
      source,
    })
    if (rule.operation === "disable") {
      state.disabledRules.add(rule.id)
      continue
    }
    if (rule.operation === "restore") {
      state.disabledRules.delete(rule.id)
      continue
    }
    if (!rule.title || !rule.content) continue
    state.rules.set(rule.id, {
      id: rule.id,
      title: rule.title,
      content: rule.content,
      source,
    })
    state.disabledRules.delete(rule.id)
  }
}

export function compositionResult(
  state: CompositionAccumulator,
  chatBookIds: readonly string[]
) {
  const contextBookIds: string[] = []
  for (const [bookId, included] of state.books) {
    if (included) contextBookIds.push(bookId)
  }
  for (const id of chatBookIds) {
    if (!state.books.has(id)) contextBookIds.push(id)
  }
  return {
    contextBookIds,
    contextEntryDecisions: state.contextEntryDecisions,
    rules: [...state.rules.values()].filter(
      (rule) => !state.disabledRules.has(rule.id)
    ),
  }
}
