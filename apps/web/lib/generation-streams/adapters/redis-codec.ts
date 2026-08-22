import type { GenerationEvent } from "@/lib/generation-streams/ports"

/** Decode an untyped Redis `XRANGE` reply into generation events. */
export function parseRedisStreamEntries(raw: unknown): GenerationEvent[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) return []
    const [cursor, fields] = entry as [unknown, unknown]
    if (typeof cursor !== "string" || !Array.isArray(fields)) return []
    const index = fields.indexOf("payload")
    const source = index < 0 ? undefined : fields[index + 1]
    if (typeof source !== "string") return []
    try {
      return [{ cursor, payload: JSON.parse(source) } satisfies GenerationEvent]
    } catch {
      return []
    }
  })
}
