import { z } from "zod"
import { sha256 } from "@noble/hashes/sha2.js"
import { MAX_COLLECTION, MAX_NAME, MAX_PROMPT_CHARS } from "@/lib/limits"
import { expandPromptMacros, type MacroContext } from "@/lib/prompt-macros"
import { PRODUCT_DEFAULTS, scanDepthSchema } from "@/lib/chat-settings"

const matchModeSchema = z.enum(["any", "all"])
const secondaryModeSchema = z.enum(["any", "all", "none", "not_all"])

export const contextBookEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().max(MAX_NAME),
  enabled: z.boolean().default(true),
  content: z.string().max(MAX_PROMPT_CHARS),
  namespace: z.string().trim().min(1).max(MAX_NAME).default("default"),
  activation: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("always") }),
    z.object({
      kind: z.literal("match"),
      keywords: z.array(z.string().min(1).max(MAX_NAME)).max(MAX_COLLECTION),
      match: matchModeSchema.default("any"),
      secondary: z
        .array(z.string().min(1).max(MAX_NAME))
        .max(MAX_COLLECTION)
        .default([]),
      secondaryMatch: secondaryModeSchema.default("any"),
      caseSensitive: z.boolean().default(false),
      wholeWord: z.boolean().default(true),
      scanRoles: z
        .array(z.enum(["user", "assistant"]))
        .min(1)
        .max(2)
        .optional(),
      scanMessages: scanDepthSchema.optional(),
    }),
  ]),
  priority: z.number().int().default(100),
  /** SillyTavern inclusion group. At most one matching entry from a group is kept. */
  group: z.string().trim().min(1).max(MAX_NAME).optional(),
  groupOverride: z.boolean().optional(),
  source: z.record(z.string(), z.unknown()).optional(),
})

export const contextBookDocumentSchema = z.object({
  version: z.literal(1).default(1),
  entries: z.array(contextBookEntrySchema).max(MAX_COLLECTION),
  scanRoles: z
    .array(z.enum(["user", "assistant"]))
    .min(1)
    .max(2)
    .default(["user", "assistant"]),
  tokenBudget: z.number().int().positive().nullable().default(null),
})

export type ContextBookDocument = z.infer<typeof contextBookDocumentSchema>
export type ContextBookEntry = z.infer<typeof contextBookEntrySchema>
export type ContextBook = {
  id: string
  name: string
  book: ContextBookDocument
}
export type ContextBookSource = ContextBook & {
  source: "space" | "chat"
  sourceName?: string
}
export type ContextEntryOverrides = Record<string, "disable" | "restore">
export type ContextScanMessage = { role: "user" | "assistant"; text: string }
export type ContextEntryDecision = {
  bookId: string
  bookName: string
  entryId: string
  entryTitle: string
  namespace: string
  status: "included" | "unmatched" | "disabled" | "budget" | "invalid"
  reason: string
  content?: string
  estimatedTokens?: number
}
export type ResolvedContextEntries = {
  namespaces: Record<string, string>
  decisions: ContextEntryDecision[]
}

/** Apply resolved space entry policies without mutating the stored book. */
export function applyContextEntryOverrides<T extends ContextBook>(
  contextBook: T,
  overrides: ContextEntryOverrides | undefined
): T {
  if (!overrides) return contextBook
  return {
    ...contextBook,
    book: {
      ...contextBook.book,
      entries: contextBook.book.entries.map((entry) => {
        const override = overrides[entry.id]
        if (!override) return entry
        return {
          ...entry,
          enabled: override === "restore" ? entry.enabled : false,
        }
      }),
    },
  }
}

export function defaultContextBook(): ContextBookDocument {
  return {
    version: 1,
    entries: [],
    scanRoles: ["user", "assistant"],
    tokenBudget: null,
  }
}

export function readContextBook(value: unknown): ContextBookDocument {
  return contextBookDocumentSchema.parse(value)
}

export function contextBookToJson(value: ContextBookDocument): string {
  return JSON.stringify(contextBookDocumentSchema.parse(value))
}

export function contextBookFingerprint(book: ContextBookDocument): string {
  const digest = sha256(new TextEncoder().encode(contextBookToJson(book)))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  )
}

export function createContextBookEntry(): ContextBookEntry {
  return {
    id: crypto.randomUUID(),
    title: "New entry",
    enabled: true,
    content: "",
    namespace: "default",
    activation: {
      kind: "match",
      keywords: [],
      match: "any",
      secondary: [],
      secondaryMatch: "any",
      caseSensitive: false,
      wholeWord: true,
    },
    priority: 100,
  }
}

function literalMatches(
  haystack: string,
  needle: string,
  caseSensitive: boolean,
  wholeWord: boolean
) {
  const source = caseSensitive ? haystack : haystack.toLocaleLowerCase()
  const key = caseSensitive ? needle : needle.toLocaleLowerCase()
  if (!wholeWord) return source.includes(key)
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  try {
    return new RegExp(
      `(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`,
      "u"
    ).test(source)
  } catch {
    return source.includes(key)
  }
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4)
}

function entryMatches(
  entry: ContextBookEntry,
  book: ContextBookDocument,
  messages: readonly ContextScanMessage[],
  scanDepth: number | null
) {
  if (entry.activation.kind === "always")
    return { yes: true, reason: "Always active" }
  const rule = entry.activation
  if (rule.keywords.length === 0)
    return { yes: false, reason: "No primary triggers" }
  const roles = rule.scanRoles ?? book.scanRoles
  const count = rule.scanMessages === undefined ? scanDepth : rule.scanMessages
  const scan = (count === null ? messages : messages.slice(-count))
    .filter((message) => roles.includes(message.role))
    .map((message) => message.text)
    .join("\n")
  const test = (key: string) =>
    literalMatches(scan, key, rule.caseSensitive, rule.wholeWord)
  const primary = rule.keywords.map(test)
  const primaryOk =
    rule.match === "all" ? primary.every(Boolean) : primary.some(Boolean)
  if (!primaryOk)
    return { yes: false, reason: "Primary triggers did not match" }
  if (rule.secondary.length === 0)
    return { yes: true, reason: "Primary trigger matched" }
  const secondary = rule.secondary.map(test)
  const secondaryOk =
    rule.secondaryMatch === "all"
      ? secondary.every(Boolean)
      : rule.secondaryMatch === "none"
        ? secondary.every((value) => !value)
        : rule.secondaryMatch === "not_all"
          ? !secondary.every(Boolean)
          : secondary.some(Boolean)
  return {
    yes: secondaryOk,
    reason: secondaryOk
      ? "Primary and secondary conditions matched"
      : "Secondary conditions rejected the match",
  }
}

type RankedEntry = {
  bookIndex: number
  entryIndex: number
  priority: number
  group?: string
  groupOverride?: boolean
  decision: ContextEntryDecision
}

/** Highest priority wins. Equal priority keeps the earlier entry. */
function inclusionGroupWinner(members: RankedEntry[]) {
  const overrides = members.filter((item) => item.groupOverride)
  const pool = overrides.length > 0 ? overrides : members
  return pool.reduce((best, item) =>
    item.priority > best.priority ||
    (item.priority === best.priority && item.entryIndex < best.entryIndex)
      ? item
      : best
  )
}

function applyInclusionGroups(candidates: RankedEntry[]) {
  let active = candidates
  let removed = true
  while (removed) {
    removed = false
    const drop = new Set<RankedEntry>()
    const groups = new Map<string, RankedEntry[]>()
    for (const candidate of active) {
      if (!candidate.group) continue
      for (const name of candidate.group.split(",")) {
        const key = name.trim()
        if (!key) continue
        const list = groups.get(key)
        if (list) list.push(candidate)
        else groups.set(key, [candidate])
      }
    }
    for (const name of [...groups.keys()].sort()) {
      const members = groups.get(name) ?? []
      if (members.length <= 1) continue
      const winner = inclusionGroupWinner(members)
      for (const item of members) {
        if (item !== winner) drop.add(item)
      }
    }
    if (drop.size > 0) {
      active = active.filter((item) => !drop.has(item))
      removed = true
    }
  }
  return active
}

export function resolveContextEntries(input: {
  books: readonly ContextBookSource[]
  messages: readonly ContextScanMessage[]
  scanDepth?: number | null
  macroContext?: MacroContext
}): ResolvedContextEntries {
  const decisions: ContextEntryDecision[] = []
  const included: RankedEntry[] = []
  input.books.forEach((source, bookIndex) => {
    const candidates: RankedEntry[] = []
    source.book.entries.forEach((entry, entryIndex) => {
      const base = {
        bookId: source.id,
        bookName: source.name,
        entryId: entry.id,
        entryTitle: entry.title,
        namespace: entry.namespace,
      } as const
      if (!entry.enabled) {
        decisions.push({
          ...base,
          status: "disabled",
          reason: "Entry is disabled",
        })
        return
      }
      const match = entryMatches(
        entry,
        source.book,
        input.messages,
        input.scanDepth === undefined
          ? PRODUCT_DEFAULTS.contextScanDepth
          : input.scanDepth
      )
      if (!match.yes) {
        decisions.push({ ...base, status: "unmatched", reason: match.reason })
        return
      }
      if (/{{\s*contextEntries\b/i.test(entry.content)) {
        decisions.push({
          ...base,
          status: "invalid",
          reason: "Context entries cannot call contextEntries",
        })
        return
      }
      const content = expandPromptMacros(
        entry.content,
        input.macroContext
      ).trim()
      const estimatedTokens = estimateTokens(content)
      const decision: ContextEntryDecision = {
        ...base,
        status: "included",
        reason: match.reason,
        content,
        estimatedTokens,
      }
      candidates.push({
        bookIndex,
        entryIndex,
        priority: entry.priority,
        ...(entry.group ? { group: entry.group } : {}),
        ...(entry.groupOverride ? { groupOverride: true } : {}),
        decision,
      })
    })
    const kept = new Set(applyInclusionGroups(candidates))
    for (const candidate of candidates) {
      if (kept.has(candidate)) continue
      decisions.push({
        ...candidate.decision,
        content: undefined,
        estimatedTokens: undefined,
        status: "unmatched",
        reason: "Another entry in this inclusion group was selected",
      })
    }
    let used = 0
    for (const candidate of [...kept].sort(
      (a, b) => b.priority - a.priority || a.entryIndex - b.entryIndex
    )) {
      const cost = candidate.decision.estimatedTokens ?? 0
      if (
        source.book.tokenBudget !== null &&
        used + cost > source.book.tokenBudget
      ) {
        decisions.push({
          ...candidate.decision,
          content: undefined,
          status: "budget",
          reason: `Skipped by ${source.book.tokenBudget}-token book budget`,
        })
      } else {
        used += cost
        included.push(candidate)
        decisions.push(candidate.decision)
      }
    }
  })
  const namespaces: Record<string, string[]> = {}
  for (const item of included.sort(
    (a, b) => a.bookIndex - b.bookIndex || a.entryIndex - b.entryIndex
  )) {
    const content = item.decision.content
    if (!content) continue
    ;(namespaces[item.decision.namespace] ??= []).push(content)
  }
  return {
    namespaces: Object.fromEntries(
      Object.entries(namespaces).map(([name, values]) => [
        name,
        values.join("\n\n"),
      ])
    ),
    decisions,
  }
}
