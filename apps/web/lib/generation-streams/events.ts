import type { Parts, ToolInvocationPart } from "@/lib/types"
import { upsertToolInvocation } from "@/lib/agent/parts"

/**
 * Application-owned events stored for a generation. Keeping this protocol
 * independent of the AI SDK makes replay and crash recovery deterministic.
 */
export type GenerationPayload =
  | { type: "parts-snapshot"; parts: Parts }
  | { type: "text-delta"; delta: string }
  | { type: "reasoning-delta"; delta: string }
  | { type: "tool-upsert"; tool: ToolInvocationPart }
  | { type: "error"; errorText: string }

export function reduceGenerationPayload(parts: Parts, event: GenerationPayload): Parts {
  if (event.type === "parts-snapshot") return [...event.parts]
  if (event.type === "tool-upsert") return upsertToolInvocation(parts, event.tool)
  if (event.type === "error") return parts

  const type = event.type === "text-delta" ? "text" : "reasoning"
  const last = parts.at(-1)
  if (last?.type === type)
    return [...parts.slice(0, -1), { type, text: last.text + event.delta }]
  return [...parts, { type, text: event.delta }]
}
