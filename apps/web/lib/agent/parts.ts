import { z } from "zod"
import { MAX_ATTACHMENT_TEXT_CHARS } from "@/lib/types"
import type {
  AttachmentContent,
  AttachmentPart,
  AttachmentReference,
  AttachmentSource,
  MessageStatus,
  Part,
  Parts,
  ToolInvocationPart,
} from "@/lib/types"

export type {
  Parts,
  Part,
  ToolInvocationPart,
  AttachmentContent,
  AttachmentPart,
  AttachmentReference,
  AttachmentSource,
}

export const toolInvocationStateSchema = z.enum([
  "input-streaming",
  "input-available",
  "output-available",
  "output-error",
])

export const attachmentSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("mcp-resource"),
    profileId: z.string().min(1),
    profileName: z.string().min(1),
    uri: z.string().min(1),
  }),
])

export const attachmentReferenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("mcp-resource"),
      profileId: z.string().min(1),
      uri: z.string().min(1).max(4_000),
    })
    .strict(),
])

export const attachmentContentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string().min(1).max(MAX_ATTACHMENT_TEXT_CHARS),
    truncated: z
      .object({ originalCharacters: z.number().int().positive() })
      .optional(),
  }),
])

export const attachmentPartSchema = z.object({
  type: z.literal("attachment"),
  id: z.string().min(1),
  name: z.string().min(1),
  source: attachmentSourceSchema,
  content: attachmentContentSchema,
})

export const partsSchema = z.array(
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("text"), text: z.string() }),
    z.object({ type: z.literal("reasoning"), text: z.string() }),
    z.object({
      type: z.literal("tool-invocation"),
      toolCallId: z.string().min(1),
      toolName: z.string().min(1),
      state: toolInvocationStateSchema,
      input: z.unknown(),
      output: z.unknown().optional(),
      errorText: z.string().optional(),
    }),
    attachmentPartSchema,
  ])
)

export type ParsedParts = z.infer<typeof partsSchema>

/** Visible prose (text + attachment text bodies). */
export function textFromParts(parts: Parts): string {
  const chunks: string[] = []
  for (const part of parts) {
    if (part.type === "text" && part.text) chunks.push(part.text)
    else if (part.type === "attachment") {
      chunks.push(`[${part.name}]\n${part.content.text}`)
    }
  }
  return chunks.join("\n")
}

/** Denormalized search index: text + attachments + short tool labels. */
export function searchTextFromParts(parts: Parts): string {
  const chunks: string[] = []
  for (const part of parts) {
    if (part.type === "text" && part.text) chunks.push(part.text)
    else if (part.type === "attachment") {
      chunks.push(`attachment:${part.name}`)
      if (part.source.kind === "mcp-resource") {
        chunks.push(`mcp-resource:${part.source.uri}`)
      }
      chunks.push(part.content.text)
    } else if (part.type === "tool-invocation") {
      chunks.push(toolSearchSnippet(part))
    }
  }
  return chunks.join("\n")
}

/** How attachment content is presented to the model. */
export function attachmentModelText(part: AttachmentPart): string {
  const locator =
    part.source.kind === "mcp-resource" ? ` (${part.source.uri})` : ""
  const truncated = part.content.truncated
    ? `\n\n[Truncated from ${part.content.truncated.originalCharacters} characters.]`
    : ""
  return `[Attachment: ${part.name}${locator}]\n${part.content.text}${truncated}`
}

function toolSearchSnippet(part: ToolInvocationPart): string {
  if (part.toolName === "question") {
    const headers = questionHeaders(part.input)
    if (headers.length > 0) return `question: ${headers.join("; ")}`
  }
  return `tool:${part.toolName}`
}

function questionHeaders(input: unknown): string[] {
  if (!input || typeof input !== "object") return []
  const questions = (input as { questions?: unknown }).questions
  if (!Array.isArray(questions)) return []
  return questions
    .map((q) =>
      q &&
      typeof q === "object" &&
      typeof (q as { header?: unknown }).header === "string"
        ? (q as { header: string }).header
        : null
    )
    .filter((h): h is string => Boolean(h))
}

export function isToolInvocationPart(part: Part): part is ToolInvocationPart {
  return part.type === "tool-invocation"
}

export function isAttachmentPart(part: Part): part is AttachmentPart {
  return part.type === "attachment"
}

export function hasToolInvocations(parts: Parts): boolean {
  return parts.some(isToolInvocationPart)
}

/** Durable / resumable client tools only (fully parsed args). */
export function pendingToolInvocations(parts: Parts): ToolInvocationPart[] {
  return parts.filter(
    (part): part is ToolInvocationPart =>
      part.type === "tool-invocation" && part.state === "input-available"
  )
}

/**
 * Whether every pending toolCallId has a corresponding result entry.
 * Used by the message UI to fire a single resume with full toolResults.
 */
export function allPendingResultsReady(
  pendingIds: string[],
  results: Record<string, unknown>
): boolean {
  if (pendingIds.length === 0) return false
  return pendingIds.every((id) =>
    Object.prototype.hasOwnProperty.call(results, id)
  )
}

export function partsHavePendingClientTools(parts: Parts): boolean {
  return pendingToolInvocations(parts).length > 0
}

export function isEmptyParts(parts: Parts): boolean {
  return !parts.some((part) => {
    if (part.type === "text" || part.type === "reasoning")
      return part.text.trim().length > 0
    return true
  })
}

/** Build text/reasoning-only parts from stream partials (tool-free path). */
export function partsFromTextReasoning(text: string, reasoning: string): Parts {
  return [
    ...(reasoning ? [{ type: "reasoning" as const, text: reasoning }] : []),
    ...(text ? [{ type: "text" as const, text }] : []),
  ]
}

export function applyToolOutputs(
  parts: Parts,
  results: Array<{ toolCallId: string; output: unknown; errorText?: string }>
): Parts {
  const byId = new Map(results.map((r) => [r.toolCallId, r]))
  return parts.map((part) => {
    if (part.type !== "tool-invocation") return part
    const result = byId.get(part.toolCallId)
    if (!result) return part
    if (result.errorText != null) {
      return {
        ...part,
        state: "output-error" as const,
        errorText: result.errorText,
        output: undefined,
      }
    }
    return {
      ...part,
      state: "output-available" as const,
      output: result.output,
      errorText: undefined,
    }
  })
}

export function upsertToolInvocation(
  parts: Parts,
  invocation: ToolInvocationPart
): Parts {
  const index = parts.findIndex(
    (p) =>
      p.type === "tool-invocation" && p.toolCallId === invocation.toolCallId
  )
  if (index === -1) return [...parts, invocation]
  const next = parts.slice()
  next[index] = invocation
  return next
}

export function terminalStatusForParts(
  outcome: "complete" | "awaiting_input" | "aborted" | "error",
  parts: Parts
): MessageStatus {
  if (outcome === "error") return "error"
  if (outcome === "aborted") return "stopped"
  if (outcome === "awaiting_input" || partsHavePendingClientTools(parts))
    return "awaiting_input"
  return "complete"
}

/**
 * Prefer a durable awaiting_input checkpoint when client tools are pending.
 * Abort/complete alone must not discard a finished question tool call just
 * because the browser tab closed after the model step ended.
 */
export function resolveStreamTerminalOutcome(
  outcome: "complete" | "awaiting_input" | "aborted" | "error",
  parts: Parts
): "complete" | "awaiting_input" | "aborted" | "error" {
  if (
    partsHavePendingClientTools(parts) &&
    (outcome === "complete" || outcome === "aborted")
  ) {
    return "awaiting_input"
  }
  return outcome
}
