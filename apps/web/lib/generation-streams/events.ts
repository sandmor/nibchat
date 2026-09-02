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
  | {
      type: "text-start"
      id: string
      providerMetadata?: Record<string, unknown>
    }
  | {
      type: "reasoning-start"
      id: string
      providerMetadata?: Record<string, unknown>
    }
  | {
      type: "text-delta"
      id: string
      delta: string
      providerMetadata?: Record<string, unknown>
    }
  | {
      type: "reasoning-delta"
      id: string
      delta: string
      providerMetadata?: Record<string, unknown>
    }
  | { type: "text-end"; id: string; providerMetadata?: Record<string, unknown> }
  | {
      type: "reasoning-end"
      id: string
      providerMetadata?: Record<string, unknown>
    }
  | { type: "tool-upsert"; tool: ToolInvocationPart }
  | { type: "error"; errorText: string }
  | GenerationTerminalPayload

export function reduceGenerationPayload(
  parts: Parts,
  event: GenerationPayload
): Parts {
  if (event.type === "parts-snapshot") return [...event.parts]
  if (event.type === "tool-upsert")
    return upsertToolInvocation(parts, event.tool)
  if (event.type === "error" || event.type === "terminal") return parts

  if (event.type === "text-start" || event.type === "reasoning-start") {
    return [
      ...parts,
      {
        type: event.type === "text-start" ? "text" : "reasoning",
        text: "",
        streamId: event.id,
        ...(event.providerMetadata
          ? { providerMetadata: event.providerMetadata }
          : {}),
      },
    ]
  }

  if (event.type === "text-end" || event.type === "reasoning-end") {
    const streamId = event.id
    return parts.map((part) =>
      (part.type === "text" || part.type === "reasoning") &&
      part.streamId === streamId
        ? {
            ...part,
            ...(event.providerMetadata
              ? { providerMetadata: event.providerMetadata }
              : {}),
          }
        : part
    )
  }

  const type = event.type === "text-delta" ? "text" : "reasoning"
  const index = parts.findIndex(
    (part) => part.type === type && part.streamId === event.id
  )
  if (index >= 0) {
    const current = parts[index] as Extract<
      Parts[number],
      { type: typeof type }
    >
    return [
      ...parts.slice(0, index),
      {
        ...current,
        text: current.text + event.delta,
        ...(event.providerMetadata
          ? { providerMetadata: event.providerMetadata }
          : {}),
      },
      ...parts.slice(index + 1),
    ]
  }
  return [
    ...parts,
    {
      type,
      text: event.delta,
      streamId: event.id,
      ...(event.providerMetadata
        ? { providerMetadata: event.providerMetadata }
        : {}),
    },
  ]
}
