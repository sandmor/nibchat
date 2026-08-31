export const builtInToolCatalog = [
  {
    id: "question",
    title: "Ask questions",
    description:
      "Pause generation to ask multiple-choice or freeform questions instead of guessing.",
  },
] as const

export type BuiltInToolId = (typeof builtInToolCatalog)[number]["id"]

export const builtInToolIds: readonly BuiltInToolId[] = builtInToolCatalog.map(
  (tool) => tool.id
)

export type BuiltInToolsPrefs = {
  disabled: BuiltInToolId[]
}

export const defaultBuiltInToolsPrefs: BuiltInToolsPrefs = { disabled: [] }

const knownIds = new Set<string>(builtInToolIds)

export function isBuiltInToolId(id: string): id is BuiltInToolId {
  return knownIds.has(id)
}

export function normalizeBuiltInToolsDisabled(
  ids: readonly string[]
): BuiltInToolId[] {
  const disabled: BuiltInToolId[] = []
  const seen = new Set<BuiltInToolId>()
  for (const id of ids) {
    if (!isBuiltInToolId(id) || seen.has(id)) continue
    seen.add(id)
    disabled.push(id)
  }
  return disabled
}

export function parseBuiltInToolsJson(raw: string): BuiltInToolsPrefs {
  const parsed = JSON.parse(raw) as { disabled?: unknown }
  if (!Array.isArray(parsed.disabled))
    throw new Error("Invalid built-in tools preferences")
  return { disabled: normalizeBuiltInToolsDisabled(parsed.disabled) }
}

export function builtInToolsToJson(prefs: BuiltInToolsPrefs): string {
  return JSON.stringify({ disabled: prefs.disabled })
}
