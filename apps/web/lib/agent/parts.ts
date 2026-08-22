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
  ReasoningPart,
  TextPart,
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

const attachmentSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("mcp-resource"),
    profileId: z.string().min(1),
    profileName: z.string().min(1),
    uri: z.string().min(1),
  }),
  z.object({ kind: z.literal("upload") }),
])

export const attachmentReferenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("mcp-resource"),
      profileId: z.string().min(1),
      uri: z.string().min(1).max(4_000),
    })
    .strict(),
  z
    .object({ kind: z.literal("uploaded-file"), id: z.string().min(1) })
    .strict(),
])

const attachmentContentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string().min(1).max(MAX_ATTACHMENT_TEXT_CHARS),
    truncated: z
      .object({ originalCharacters: z.number().int().positive() })
      .optional(),
  }),
  z.object({
    kind: z.literal("binary"),
    attachmentId: z.string().min(1),
    mediaType: z.string().regex(/^image\/(jpeg|png|webp|gif)$/),
    byteSize: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({
    kind: z.literal("document"),
    attachmentId: z.string().min(1),
    mediaType: z.literal("application/pdf"),
    byteSize: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    analysis: z.discriminatedUnion("status", [
      z.object({
        status: z.literal("ready"),
        pdfType: z.enum(["TextBased", "Scanned", "ImageBased", "Mixed"]),
        pageCount: z.number().int().positive(),
        markdown: z.string().min(1).max(MAX_ATTACHMENT_TEXT_CHARS),
      }),
      z.object({
        status: z.enum(["no-text", "failed", "unavailable"]),
        pdfType: z
          .enum(["TextBased", "Scanned", "ImageBased", "Mixed"])
          .optional(),
        pageCount: z.number().int().positive().optional(),
      }),
    ]),
  }),
])

export const attachmentPartSchema = z.object({
  type: z.literal("attachment"),
  id: z.string().min(1),
  name: z.string().min(1),
  source: attachmentSourceSchema,
  content: attachmentContentSchema,
})

/** Visible prose (text + attachment text bodies). */
export function textFromParts(parts: Parts): string {
  const chunks: string[] = []
  for (const part of parts) {
    if (part.type === "text" && part.text) chunks.push(part.text)
    else if (part.type === "attachment") {
      if (part.content.kind === "text")
        chunks.push(`[${part.name}]\n${part.content.text}`)
      else if (part.content.kind === "document")
        chunks.push(`[PDF: ${part.name}]`)
      else chunks.push(`[Image: ${part.name}]`)
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
      if (part.content.kind === "text") chunks.push(part.content.text)
    } else if (part.type === "tool-invocation") {
      chunks.push(toolSearchSnippet(part))
    }
  }
  return chunks.join("\n")
}

/**
 * In-conversation Find corpus. Visible MessageParts chrome and bodies:
 * prose (markdown source), attachment labels/body, tool chrome/output,
 * pending question header/prompt/options, answered question summary
 * (header + answers / Unanswered). Skips reasoning. Occurrence index (not
 * source offset) maps onto concatenated DOM text. Not the SQL search_text
 * index (that keeps attachment:/tool: prefixes).
 */
export function conversationFindTextFromParts(parts: Parts): string {
  const chunks: string[] = []
  for (const part of parts) {
    if (part.type === "reasoning") continue
    if (part.type === "text" && part.text) chunks.push(part.text)
    else if (part.type === "attachment") {
      if (part.content.kind === "binary" || part.content.kind === "document") {
        chunks.push(part.name)
        continue
      }
      chunks.push(`Attached: ${part.name}`)
      if (part.source.kind === "mcp-resource") {
        chunks.push(part.source.profileName)
        chunks.push(part.source.uri)
      }
      chunks.push(part.content.text)
      if (part.content.truncated) {
        chunks.push(
          `Truncated from ${part.content.truncated.originalCharacters} characters.`
        )
      }
    } else if (part.type === "tool-invocation") {
      chunks.push(toolFindText(part))
    }
  }
  return chunks.join("\n")
}

/** How attachment content is presented to the model. */
export function attachmentModelText(part: AttachmentPart): string {
  if (part.content.kind === "binary") return `[Image attachment: ${part.name}]`
  if (part.content.kind === "document") {
    if (part.content.analysis.status !== "ready")
      return `[PDF attachment: ${part.name}]`
    return `[PDF attachment: ${part.name}]\n${part.content.analysis.markdown}`
  }
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

function toolFindText(part: ToolInvocationPart): string {
  if (part.toolName === "question") return questionFindText(part)
  const chunks = [`Tool · ${part.toolName} · ${part.state}`]
  if (part.state === "output-available" && part.output != null) {
    chunks.push(stringifyToolOutput(part.output))
  }
  return chunks.join("\n")
}

function stringifyToolOutput(output: unknown) {
  return typeof output === "string" ? output : JSON.stringify(output, null, 2)
}

function questionHeaders(input: unknown): string[] {
  return questionFields(input, "header")
}

function questionFindText(part: ToolInvocationPart): string {
  if (part.state === "input-streaming") return ""
  const answered =
    part.state === "output-available" ||
    part.state === "output-error" ||
    answersFromQuestionOutput(part.output)
  if (answered) return questionSummaryFindText(part)
  if (part.state !== "input-available") return ""
  return [
    ...questionFields(part.input, "header"),
    ...questionFields(part.input, "question"),
    ...questionOptionText(part.input),
  ].join("\n")
}

function questionSummaryFindText(part: ToolInvocationPart): string {
  const chunks = [...questionFields(part.input, "header")]
  const answers = answersFromQuestionOutput(part.output)
  const count = questionCount(part.input)
  for (let index = 0; index < count; index++) {
    const group = answers?.[index] ?? []
    const labels = group.filter(
      (label): label is string => typeof label === "string" && Boolean(label)
    )
    chunks.push(labels.length === 0 ? "Unanswered" : labels.join(", "))
  }
  if (part.state === "output-error" && part.errorText) {
    chunks.push(part.errorText)
  }
  return chunks.join("\n")
}

function questionCount(input: unknown) {
  if (!input || typeof input !== "object") return 0
  const questions = (input as { questions?: unknown }).questions
  return Array.isArray(questions) ? questions.length : 0
}

function questionFields(input: unknown, key: "header" | "question"): string[] {
  if (!input || typeof input !== "object") return []
  const questions = (input as { questions?: unknown }).questions
  if (!Array.isArray(questions)) return []
  return questions
    .map((q) => {
      if (!q || typeof q !== "object") return null
      const value = (q as Record<string, unknown>)[key]
      return typeof value === "string" ? value : null
    })
    .filter((value): value is string => Boolean(value))
}

function questionOptionText(input: unknown): string[] {
  if (!input || typeof input !== "object") return []
  const questions = (input as { questions?: unknown }).questions
  if (!Array.isArray(questions)) return []
  const chunks: string[] = []
  for (const q of questions) {
    if (!q || typeof q !== "object") continue
    const options = (q as { options?: unknown }).options
    if (!Array.isArray(options)) continue
    for (const option of options) {
      if (!option || typeof option !== "object") continue
      const rec = option as { label?: unknown; description?: unknown }
      if (typeof rec.label === "string") chunks.push(rec.label)
      if (typeof rec.description === "string") chunks.push(rec.description)
    }
  }
  return chunks
}

function answersFromQuestionOutput(output: unknown): string[][] | null {
  if (output && typeof output === "object" && "metadata" in output) {
    const meta = (output as { metadata?: { answers?: unknown } }).metadata
    if (meta && Array.isArray(meta.answers)) {
      return meta.answers.filter((group): group is string[] =>
        Array.isArray(group)
      )
    }
  }
  if (Array.isArray(output) && output.every((group) => Array.isArray(group))) {
    return output as string[][]
  }
  return null
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

export const messageEditSegmentSchema = z.object({
  type: z.enum(["text", "reasoning"]),
  text: z.string(),
})
export type MessageEditSegment = z.infer<typeof messageEditSegmentSchema>

/** Merge streamed text deltas so adjacent prose is one document. */
export function coalesceAdjacentTextParts(parts: Parts): Parts {
  const result: Parts = []
  for (const part of parts) {
    const previous = result.at(-1)
    if (part.type === "text" && previous?.type === "text") {
      result[result.length - 1] = {
        type: "text",
        text: previous.text + part.text,
      }
      continue
    }
    result.push(part)
  }
  return result
}

export function editableSegmentsFromParts(parts: Parts): MessageEditSegment[] {
  return coalesceAdjacentTextParts(parts).flatMap((part) =>
    part.type === "text" || part.type === "reasoning"
      ? [{ type: part.type, text: part.text }]
      : []
  )
}

/**
 * Rebuild parts from a coalesced walk: text/reasoning take the matching edit,
 * tools and attachments are cloned in place. Adjacent original text parts
 * become one text part.
 */
export function applyMessageEdits(
  original: Parts,
  edits: readonly MessageEditSegment[]
): Parts {
  const coalesced = coalesceAdjacentTextParts(original)
  const expected = coalesced.filter(
    (part): part is TextPart | ReasoningPart =>
      part.type === "text" || part.type === "reasoning"
  )
  if (edits.length !== expected.length) {
    throw new Error("Edit does not match this message")
  }
  for (const [index, part] of expected.entries()) {
    if (edits[index]?.type !== part.type) {
      throw new Error("Edit does not match this message")
    }
  }
  if (
    !edits.some((segment) => segment.type === "text" && segment.text.trim())
  ) {
    throw new Error("Message is required")
  }
  const next: Parts = []
  let editIndex = 0
  for (const part of coalesced) {
    if (part.type === "text" || part.type === "reasoning") {
      const text = edits[editIndex++]!.text
      if (text) next.push({ type: part.type, text })
      continue
    }
    next.push(part)
  }
  return next
}

export function canEditMessageParts(
  status: MessageStatus,
  parts: Parts
): boolean {
  if (status === "streaming" || status === "awaiting_input") return false
  if (partsHavePendingClientTools(parts)) return false
  return editableSegmentsFromParts(parts).some(
    (segment) => segment.type === "text"
  )
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
