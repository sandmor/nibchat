import { z } from "zod"
import {
  expandPromptMacros,
  expansionLooksUnresolved,
  valueNeedsChatContext,
  type MacroContext,
} from "@/lib/prompt-macros"

/** Matches `${ENV_NAME}` template tokens inside stored connection values. */
export const ENV_TEMPLATE_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

export const configEntrySchema = z.object({
  name: z.string().min(1).max(200),
  value: z.string().max(10_000).default(""),
})

export type ConfigEntry = z.infer<typeof configEntrySchema>

export function normalizeConfigEntries(raw: unknown): ConfigEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const parsed = configEntrySchema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

export function preprocessConfigEntries(value: unknown) {
  return normalizeConfigEntries(value)
}

/** Returns undefined when any referenced environment variable is missing. */
export function resolveTemplateValue(
  value: string,
  env: Record<string, string | undefined> = process.env
): string | undefined {
  let missing = false
  const resolved = value.replace(ENV_TEMPLATE_RE, (_match, name: string) => {
    const found = env[name]
    if (found == null) {
      missing = true
      return ""
    }
    return found
  })
  return missing ? undefined : resolved
}

/** Resolve entries into request headers/env; omit empty and unresolved values. */
export function resolveConfigEntries(
  entries: ConfigEntry[],
  env: Record<string, string | undefined> = process.env
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of entries) {
    if (!entry.value) continue
    const resolved = resolveTemplateValue(entry.value, env)
    if (resolved != null) out[entry.name] = resolved
  }
  return out
}

export function headersUsePromptMacros(entries: ConfigEntry[]): boolean {
  return entries.some((entry) => entry.value.includes("{{"))
}

export function isValidHttpHeader(name: string, value: string): boolean {
  try {
    new Headers({ [name]: value })
    return true
  } catch {
    return false
  }
}

export function previewHeaderEntry(
  entry: ConfigEntry,
  context: MacroContext
): {
  expanded: string
  omittedWithoutChat: boolean
  unresolved: boolean
  invalid: boolean
} {
  const expanded = expandPromptMacros(entry.value, context)
  const unresolved = expansionLooksUnresolved(expanded)
  return {
    expanded,
    omittedWithoutChat: valueNeedsChatContext(entry.value),
    unresolved,
    invalid:
      Boolean(entry.name) &&
      !unresolved &&
      !isValidHttpHeader(entry.name, expanded),
  }
}

/** Resolve headers with the same macros available to prompt stacks. An
 * unavailable or invalid macro omits only its header, which makes connection
 * configuration safe to reuse for chat and non-chat operations. */
export function resolveHeaderEntries(
  entries: ConfigEntry[],
  options: {
    env?: Record<string, string | undefined>
    macroContext?: MacroContext
  } = {}
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of entries) {
    if (!entry.value) continue
    const templated = resolveTemplateValue(entry.value, options.env)
    if (templated == null) continue
    if (!options.macroContext?.chat && valueNeedsChatContext(templated))
      continue
    const value = expandPromptMacros(templated, options.macroContext)
    // Prompt rendering intentionally keeps unknown macros literal. Header
    // rendering treats that as an unresolved configuration entry instead.
    if (expansionLooksUnresolved(value)) continue
    if (!isValidHttpHeader(entry.name, value)) continue
    out[entry.name] = value
  }
  return out
}
