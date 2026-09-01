import type { NodeRow, Parts, ToolInvocationPart } from "@/lib/types"
import { upsertToolInvocation } from "@/lib/agent/parts"

/**
 * Application-owned events stored for a generation. Keeping this protocol
 * independent of the AI SDK makes replay and crash recovery deterministic.
 */
export type GenerationTerminalResult =
  | "complete"
  | "awaiting_input"
  | "stopped"
  | "error"
  | "deleted"
  | "missing"
  | "superseded"

export type GenerationTerminalPayload = {
  /** The durable node snapshot is ready for the static renderer. */
  type: "terminal"
  result: GenerationTerminalResult
  node: NodeRow | null
}

export type GenerationPayload =
  | { type: "parts-snapshot"; parts: Parts }
  | { type: "text-delta"; delta: string }
  | { type: "reasoning-delta"; delta: string }
  | { type: "tool-upsert"; tool: ToolInvocationPart }
  | { type: "error"; errorText: string }
  | GenerationTerminalPayload

export function reduceGenerationPayload(parts: Parts, event: GenerationPayload): Parts {
  if (event.type === "parts-snapshot") return [...event.parts]
  if (event.type === "tool-upsert") return upsertToolInvocation(parts, event.tool)
  if (event.type === "error" || event.type === "terminal") return parts

  const type = event.type === "text-delta" ? "text" : "reasoning"
  const last = parts.at(-1)
  if (last?.type === type)
    return [...parts.slice(0, -1), { type, text: last.text + event.delta }]
  return [...parts, { type, text: event.delta }]
}
