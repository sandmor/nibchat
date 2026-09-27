import {
  defaultContextBook,
  readContextBook,
  type ContextBookDocument,
} from "@/lib/context-books"
import type { ImportArchivePort } from "@/lib/imports/model"
import { readArchiveEntry } from "@/lib/imports/adapters/browser-archive"
import { sillyTavernCardJson } from "@/lib/imports/adapters/silly-tavern"
import { rewriteSillyTavernMacros } from "@/lib/imports/silly-tavern-macros"
import {
  MAX_COLLECTION,
  MAX_ID,
  MAX_NAME,
  MAX_PROMPT_CHARS,
  MAX_SCAN_DEPTH,
} from "@/lib/limits"

type Raw = Record<string, unknown>
export type WorldInfoImport = {
  name?: string
  book: ContextBookDocument
  issues: Array<{ entryId: string; reason: string }>
}
export type ExtractedWorldInfo = WorldInfoImport & {
  source: string
  fromCharacter?: boolean
}

const object = (value: unknown): Raw | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : null
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0
      )
    : typeof value === "string"
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : []

function worldInfoEntries(raw: unknown) {
  const root = object(raw)
  if (!root) return []
  return Array.isArray(root.entries)
    ? root.entries
    : Object.values(object(root.entries) ?? {})
}

function looksLikeWorldInfoEntry(value: unknown) {
  const source = object(value)
  if (!source) return false
  return (
    typeof source.content === "string" ||
    Array.isArray(source.key) ||
    Array.isArray(source.keys) ||
    typeof source.key === "string"
  )
}

export function looksLikeWorldInfo(raw: unknown) {
  return worldInfoEntries(raw).some(looksLikeWorldInfoEntry)
}

function looksLikeWorldInfoPath(name: string) {
  return /(^|\/)worlds?\//i.test(name) || /world.?info|lorebook/i.test(name)
}

function isCharacterCardPath(name: string) {
  const lower = name.toLowerCase()
  return /(^|\/)characters\/[^/]+\.png$/.test(lower) || !name.includes("/")
}

function characterBookPayload(raw: unknown) {
  const card = object(raw)
  if (!card) return null
  const data = object(card.data) ?? card
  const embedded = data && object(data.character_book)
  if (!embedded || !looksLikeWorldInfo(embedded)) return null
  return {
    book: embedded,
    name: typeof data.name === "string" ? `${data.name} context` : undefined,
  }
}

const MAX_REGEX_ALTERNATIVES = 16

function clamp(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value
}

/** `/pattern/flags` with SillyTavern's slash rules. Unescaped `/` inside is rejected. */
function slashRegex(key: string) {
  const match = /^\/([\w\W]+?)\/([gimsuy]*)$/.exec(key)
  const pattern = match?.[1]
  const flags = match?.[2]
  if (pattern === undefined || flags === undefined) return null
  if (/(^|[^\\])\//.test(pattern)) return null
  return { pattern: pattern.replace(/\\\//g, "/"), flags }
}

function splitUnescaped(pattern: string, separator: string) {
  const parts: string[] = []
  let current = ""
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]
    const next = pattern[index + 1]
    if (char === undefined) break
    if (char === "\\" && next !== undefined) {
      current += char + next
      index++
      continue
    }
    if (char === separator) {
      parts.push(current)
      current = ""
      continue
    }
    current += char
  }
  parts.push(current)
  return parts
}

/** Literals for a pattern made of text, optional characters, and `|`. */
function literalAlternatives(pattern: string) {
  const variants: string[] = []
  for (const alternative of splitUnescaped(pattern, "|")) {
    const expanded = expandAlternative(alternative)
    if (!expanded) return null
    for (const item of expanded) {
      if (item.length > MAX_NAME) return null
      if (item.length > 0) variants.push(item)
    }
    if (variants.length > MAX_REGEX_ALTERNATIVES) return null
  }
  return variants.length > 0 ? [...new Set(variants)] : null
}

function expandAlternative(source: string) {
  const atoms: Array<{ text: string; optional: boolean }> = []
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (char === undefined) break
    if (char === "\\") {
      const next = source[index + 1]
      if (!next) return null
      index++
      if (next === "b" || next === "B") continue
      if ("\\/^$.|?*+()[]{}".includes(next)) {
        atoms.push({ text: next, optional: false })
        continue
      }
      return null
    }
    if ("*+{}()[]^$.".includes(char)) return null
    if (char === "?") {
      const last = atoms.at(-1)
      if (!last || last.optional) return null
      last.optional = true
      continue
    }
    atoms.push({ text: char ?? "", optional: false })
  }
  let variants = [""]
  for (const atom of atoms) {
    variants = atom.optional
      ? variants.flatMap((item) => [item, item + atom.text])
      : variants.map((item) => item + atom.text)
    if (variants.length > MAX_REGEX_ALTERNATIVES) return null
  }
  return variants
}

function keywordCaseSensitive(keys: string[], authored: boolean) {
  const regexes = keys.flatMap((key) => {
    const regex = slashRegex(key)
    return regex ? [regex] : []
  })
  if (regexes.some((item) => item.flags.includes("i"))) return false
  if (
    keys.length > 0 &&
    regexes.length === keys.length &&
    regexes.every((item) => !item.flags.includes("i"))
  )
    return true
  return authored
}

function keywordLiterals(keys: string[]) {
  const keywords: string[] = []
  for (const key of keys) {
    const regex = slashRegex(key)
    const literals = regex ? literalAlternatives(regex.pattern) : null
    if (regex && !literals) continue
    for (const literal of literals ?? [key]) {
      const clamped = clamp(literal, MAX_NAME)
      if (clamped && !keywords.includes(clamped)) keywords.push(clamped)
      if (keywords.length >= MAX_COLLECTION) return keywords
    }
  }
  return keywords
}

function scanMessages(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined
  if (value < 1 || value > MAX_SCAN_DEPTH) return undefined
  return value
}

function entryPriority(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : 100
}

export function importSillyTavernWorldInfo(raw: unknown): WorldInfoImport {
  const root = object(raw)
  if (!root) throw new Error("Invalid SillyTavern World Info file")
  const sourceEntries = worldInfoEntries(root)
  const book = defaultContextBook(),
    issues: WorldInfoImport["issues"] = [],
    usedIds = new Set<string>()
  const mapped = sourceEntries.flatMap((value, index) => {
    const source = object(value)
    if (!source) return []
    let id = clamp(String(source.uid ?? source.id ?? index), MAX_ID)
    if (!id) id = String(index)
    if (usedIds.has(id)) id = clamp(`${id}:${index}`, MAX_ID)
    usedIds.add(id)
    const keys = strings(source.key ?? source.keys)
    const secondaryKeys =
      source.selective === false
        ? []
        : strings(source.keysecondary ?? source.secondary_keys)
    const primary = keywordLiterals(keys)
    const secondary = keywordLiterals(secondaryKeys)
    const caseSensitive = keywordCaseSensitive(
      [...keys, ...secondaryKeys],
      source.caseSensitive === true
    )
    const outletValue =
      typeof source.outletName === "string"
        ? source.outletName
        : typeof source.outlet === "string"
          ? source.outlet
          : undefined
    const groupRaw =
      typeof source.group === "string"
        ? source.group
        : typeof source.inclusion_group === "string"
          ? source.inclusion_group
          : ""
    const group = clamp(groupRaw.trim(), MAX_NAME)
    const depth = scanMessages(source.scanDepth)
    const never =
      source.useProbability === true &&
      typeof source.probability === "number" &&
      source.probability <= 0
    return [
      {
        id,
        title: clamp(
          rewriteSillyTavernMacros(
            String(
              source.comment ?? source.memo ?? keys[0] ?? `Entry ${index + 1}`
            )
          ),
          MAX_NAME
        ),
        enabled: !never && source.disable !== true && source.enabled !== false,
        content: clamp(
          rewriteSillyTavernMacros(String(source.content ?? "")),
          MAX_PROMPT_CHARS
        ),
        namespace:
          clamp(outletValue?.trim() || "default", MAX_NAME) || "default",
        activation:
          source.constant === true
            ? { kind: "always" as const }
            : {
                kind: "match" as const,
                keywords: primary,
                match: "any" as const,
                secondary,
                secondaryMatch:
                  Number(source.selectiveLogic) === 1
                    ? ("all" as const)
                    : Number(source.selectiveLogic) === 2
                      ? ("none" as const)
                      : Number(source.selectiveLogic) === 3
                        ? ("not_all" as const)
                        : ("any" as const),
                caseSensitive,
                wholeWord: source.matchWholeWords === true,
                ...(depth !== undefined ? { scanMessages: depth } : {}),
              },
        priority: entryPriority(source.order),
        ...(group ? { group } : {}),
        ...(group && source.groupOverride === true
          ? { groupOverride: true }
          : {}),
      },
    ]
  })
  if (mapped.length > MAX_COLLECTION)
    issues.push({
      entryId: "*",
      reason: `Only the first ${MAX_COLLECTION} entries were imported`,
    })
  book.entries = mapped.slice(0, MAX_COLLECTION)
  return {
    name: typeof root.name === "string" ? root.name : undefined,
    book: readContextBook(book),
    issues,
  }
}

export function sillyTavernBookEntityId(
  sourcePath: string,
  characterEntityId?: string
) {
  return (
    characterEntityId
      ? `character-book:${characterEntityId}`
      : `path:${sourcePath}`
  ).slice(0, MAX_ID)
}

function discoveredBook(
  imported: WorldInfoImport,
  source: string,
  options?: { name?: string; fromCharacter?: boolean }
): ExtractedWorldInfo {
  return {
    ...imported,
    ...(options?.name || imported.name
      ? { name: options?.name ?? imported.name }
      : {}),
    source,
    ...(options?.fromCharacter ? { fromCharacter: true } : {}),
  }
}

export async function extractSillyTavernWorldInfo(
  archive: ImportArchivePort
): Promise<ExtractedWorldInfo[]> {
  const found: ExtractedWorldInfo[] = []
  for (const name of archive.names()) {
    const lower = name.toLowerCase()
    try {
      if (lower.endsWith(".png") && isCharacterCardPath(name)) {
        const card = sillyTavernCardJson(await readArchiveEntry(archive, name))
        const embedded = characterBookPayload(card)
        if (embedded)
          found.push(
            discoveredBook(importSillyTavernWorldInfo(embedded.book), name, {
              name: embedded.name,
              fromCharacter: true,
            })
          )
        continue
      }
      if (!lower.endsWith(".json")) continue
      const parsed = JSON.parse(
        new TextDecoder().decode(await readArchiveEntry(archive, name))
      )
      const embedded = characterBookPayload(parsed)
      if (embedded) {
        found.push(
          discoveredBook(importSillyTavernWorldInfo(embedded.book), name, {
            name: embedded.name,
            fromCharacter: true,
          })
        )
        continue
      }
      if (looksLikeWorldInfo(parsed) || looksLikeWorldInfoPath(name))
        found.push(discoveredBook(importSillyTavernWorldInfo(parsed), name))
    } catch {
      // Conversation imports already report malformed cards. Book extraction
      // stays best-effort so one historical file cannot hide valid books.
    }
  }
  const unique = new Map<string, ExtractedWorldInfo>()
  for (const item of found) {
    const fingerprint = JSON.stringify(item.book)
    const existing = unique.get(fingerprint)
    if (!existing || item.fromCharacter) unique.set(fingerprint, item)
  }
  return [...unique.values()]
}
