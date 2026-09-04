import { z } from "zod"

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
