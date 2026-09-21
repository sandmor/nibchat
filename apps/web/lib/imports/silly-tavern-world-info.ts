import {
  defaultContextBook,
  type ContextBookDocument,
} from "@/lib/context-books"
import type { ImportArchivePort } from "@/lib/imports/model"
import { readArchiveEntry } from "@/lib/imports/adapters/browser-archive"
import { sillyTavernCardJson } from "@/lib/imports/adapters/silly-tavern"
import { rewriteSillyTavernMacros } from "@/lib/imports/silly-tavern-macros"
import { MAX_COLLECTION, MAX_ID } from "@/lib/limits"

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

export function importSillyTavernWorldInfo(raw: unknown): WorldInfoImport {
  const root = object(raw)
  if (!root) throw new Error("Invalid SillyTavern World Info file")
  const sourceEntries = worldInfoEntries(root)
  const book = defaultContextBook(),
    issues: WorldInfoImport["issues"] = []
  const mapped = sourceEntries.flatMap((value, index) => {
    const source = object(value)
    if (!source) return []
    const id = String(source.uid ?? source.id ?? index)
    const keys = strings(source.key ?? source.keys)
    const secondary = strings(source.keysecondary ?? source.secondary_keys)
    const outletValue =
      typeof source.outletName === "string"
        ? source.outletName
        : typeof source.outlet === "string"
          ? source.outlet
          : undefined
    const outlet = outletValue ?? "default"
    const unsupported: string[] = []
    if (
      source.useProbability === true ||
      (typeof source.probability === "number" && source.probability !== 100)
    )
      unsupported.push("probability")
    if (source.group || source.inclusion_group)
      unsupported.push("inclusion groups")
    if (source.sticky || source.cooldown || source.delay)
      unsupported.push("timed activation")
    if (keys.some((key) => /^\/.+\/[a-z]*$/i.test(key)))
      unsupported.push("regular expressions")
    const position = source.position
    if (position !== undefined && position !== 7 && !outletValue)
      unsupported.push("automatic placement")
    if (unsupported.length)
      issues.push({
        entryId: id,
        reason: `Unsupported: ${unsupported.join(", ")}`,
      })
    return [
      {
        id,
        title: rewriteSillyTavernMacros(
          String(
            source.comment ?? source.memo ?? keys[0] ?? `Entry ${index + 1}`
          )
        ),
        enabled:
          source.disable !== true &&
          source.enabled !== false &&
          unsupported.length === 0,
        content: rewriteSillyTavernMacros(String(source.content ?? "")),
        namespace: outlet.trim() || "default",
        activation:
          source.constant === true
            ? { kind: "always" as const }
            : {
                kind: "match" as const,
                keywords: keys,
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
                caseSensitive: source.caseSensitive === true,
                wholeWord: source.matchWholeWords !== false,
              },
        priority: typeof source.order === "number" ? source.order : 100,
        source: {
          ...source,
          ...(unsupported.length ? { compatibilityIssues: unsupported } : {}),
        },
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
    book,
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
