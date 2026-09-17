import {
  defaultContextBook,
  type ContextBookDocument,
} from "@/lib/context-books"
import type { ImportArchivePort } from "@/lib/imports/model"
import { readArchiveEntry } from "@/lib/imports/adapters/browser-archive"
import { sillyTavernCardJson } from "@/lib/imports/adapters/silly-tavern"

type Raw = Record<string, unknown>
export type WorldInfoImport = {
  name?: string
  book: ContextBookDocument
  issues: Array<{ entryId: string; reason: string }>
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

export function importSillyTavernWorldInfo(raw: unknown): WorldInfoImport {
  const root = object(raw)
  if (!root) throw new Error("Invalid SillyTavern World Info file")
  const sourceEntries = Array.isArray(root.entries)
    ? root.entries
    : Object.values(object(root.entries) ?? {})
  const book = defaultContextBook(),
    issues: WorldInfoImport["issues"] = []
  book.entries = sourceEntries.flatMap((value, index) => {
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
        title: String(
          source.comment ?? source.memo ?? keys[0] ?? `Entry ${index + 1}`
        ),
        enabled:
          source.disable !== true &&
          source.enabled !== false &&
          unsupported.length === 0,
        content: String(source.content ?? ""),
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
  return {
    name: typeof root.name === "string" ? root.name : undefined,
    book,
    issues,
  }
}

export async function extractSillyTavernWorldInfo(
  archive: ImportArchivePort
): Promise<Array<WorldInfoImport & { source: string }>> {
  const found: Array<WorldInfoImport & { source: string }> = []
  for (const name of archive.names()) {
    const lower = name.toLowerCase()
    try {
      if (
        lower.endsWith(".png") &&
        (lower.includes("characters/") || !name.includes("/"))
      ) {
        const card = sillyTavernCardJson(await readArchiveEntry(archive, name))
        const data = object(card?.data) ?? card
        const embedded = data && object(data.character_book)
        if (embedded)
          found.push({
            ...importSillyTavernWorldInfo(embedded),
            name:
              typeof data?.name === "string"
                ? `${data.name} context`
                : undefined,
            source: name,
          })
      } else if (
        lower.endsWith(".json") &&
        (/(^|\/)worlds?\//i.test(name) || /world.?info|lorebook/i.test(name))
      ) {
        const parsed = JSON.parse(
          new TextDecoder().decode(await readArchiveEntry(archive, name))
        )
        found.push({ ...importSillyTavernWorldInfo(parsed), source: name })
      }
    } catch {
      // Conversation imports already report malformed cards. Book extraction
      // stays best-effort so one historical file cannot hide valid books.
    }
  }
  const unique = new Map<string, WorldInfoImport & { source: string }>()
  for (const item of found) {
    const fingerprint = JSON.stringify(item.book)
    const existing = unique.get(fingerprint)
    // An embedded card copy carries the more specific relationship.
    if (!existing || item.source.toLowerCase().endsWith(".png"))
      unique.set(fingerprint, item)
  }
  return [...unique.values()]
}
