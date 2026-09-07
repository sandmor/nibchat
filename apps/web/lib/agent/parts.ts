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
  MessageRole,
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
      resolution: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("live") }).strict(),
        z
          .object({ kind: z.literal("snapshot"), id: z.string().min(1) })
          .strict(),
      ]),
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

/** Durable message payload accepted by authored-message and replacement APIs. */
export const messagePartSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text"),
      text: z.string(),
      streamId: z.string().optional(),
      providerMetadata: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("reasoning"),
      text: z.string(),
      streamId: z.string().optional(),
      providerMetadata: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool-invocation"),
      toolCallId: z.string().min(1),
      toolName: z.string().min(1),
      state: z.enum([
        "input-streaming",
        "input-available",
        "output-available",
        "output-error",
      ]),
      input: z.unknown(),
      output: z.unknown().optional(),
      errorText: z.string().optional(),
      providerMetadata: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  attachmentPartSchema,
])

export const messagePartsSchema = z.array(messagePartSchema).min(1)

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

/**
 * Continue sends MCP as explicit live reads or retained snapshots. Snapshot
 * references must identify an attachment on the validated edit source.
 */
export function reuseMcpAttachmentSnapshots(
  sourceParts: Parts,
  references: AttachmentReference[]
): {
  reused: AttachmentPart[]
  unresolved: Extract<AttachmentReference, { kind: "mcp-resource" }>[]
} {
  const snapshots = new Map<string, AttachmentPart>()
  for (const part of sourceParts) {
    if (part.type !== "attachment" || part.source.kind !== "mcp-resource")
      continue
    snapshots.set(part.id, part)
  }
  const reused: AttachmentPart[] = []
  const unresolved: Extract<AttachmentReference, { kind: "mcp-resource" }>[] =
    []
  for (const reference of references) {
    if (reference.kind !== "mcp-resource") continue
    if (reference.resolution.kind === "live") {
      unresolved.push(reference)
      continue
    }
    const snapshot = snapshots.get(reference.resolution.id)
    if (!snapshot)
      throw new Error("Retained MCP attachment snapshot was not found.")
    if (
      snapshot.source.kind !== "mcp-resource" ||
      snapshot.source.profileId !== reference.profileId ||
      snapshot.source.uri !== reference.uri
    )
      throw new Error(
        "Retained MCP attachment snapshot does not match resource."
      )
    reused.push(snapshot)
  }
  return { reused, unresolved }
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

/** Conversation roles have distinct durable capabilities. */
export function assertPartsAllowedForRole(role: MessageRole, parts: Parts) {
  if (role === "user") {
    if (
      parts.some(
        (part) => part.type === "reasoning" || part.type === "tool-invocation"
      )
    )
      throw new Error("User messages cannot contain reasoning or tool calls.")
    return
  }
  if (role === "assistant" && parts.some((part) => part.type === "attachment"))
    throw new Error("Assistant messages cannot contain attachments.")
}

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

export function canEditMessage(status: MessageStatus, _parts?: Parts): boolean {
  return status !== "awaiting_input"
}

/**
 * Turn live or authored parts into a durable document. Incomplete tool
 * argument streams cannot be stored; tools that never ran become cancelled
 * records instead of executable calls.
 */
export function durableAuthoredParts(parts: Parts): Parts {
  const next: Parts = []
  for (const part of parts) {
    if (part.type !== "tool-invocation") {
      next.push(part)
      continue
    }
    if (part.state === "input-streaming") continue
    if (part.state === "input-available") {
      next.push({
        ...part,
        state: "output-error",
        errorText: "Cancelled before the tool ran.",
      })
      continue
    }
    next.push(part)
  }
  return dropEmptyTextLikeParts(next)
}

export function uniqueAttachmentReferences(
  references: AttachmentReference[]
): AttachmentReference[] {
  const seen = new Set<string>()
  return references.filter((reference) => {
    const key =
      reference.kind === "mcp-resource"
        ? `${reference.kind}\u0000${reference.profileId}\u0000${reference.uri}`
        : `${reference.kind}\u0000${reference.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function uploadedAttachmentId(
  part: Extract<Part, { type: "attachment" }>
) {
  return part.content.kind === "binary" || part.content.kind === "document"
    ? part.content.attachmentId
    : undefined
}

export const EDITOR_PART_TYPES = [
  "text",
  "reasoning",
  "tool-invocation",
] as const
export type EditorPartType = (typeof EDITOR_PART_TYPES)[number]
export type ConversationAuthorRole = Extract<MessageRole, "user" | "assistant">

export function editorPartTypesForRole(
  role: ConversationAuthorRole
): EditorPartType[] {
  return role === "user" ? ["text"] : ["text", "reasoning", "tool-invocation"]
}

export function createEditorPart(type: EditorPartType): Part {
  if (type === "text") return { type: "text", text: "" }
  if (type === "reasoning") return { type: "reasoning", text: "" }
  return {
    type: "tool-invocation",
    toolCallId: crypto.randomUUID(),
    toolName: "tool",
    state: "output-available",
    input: {},
  }
}

export function toolRecordJson(part: ToolInvocationPart): string {
  return JSON.stringify(
    {
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      state: part.state,
      input: part.input,
      ...(part.output !== undefined ? { output: part.output } : {}),
      ...(part.errorText ? { errorText: part.errorText } : {}),
    },
    null,
    2
  )
}

export function convertPart(part: Part, to: EditorPartType): Part {
  if (part.type === to) return part
  if (part.type === "attachment") return part
  if (to === "tool-invocation") {
    return createEditorPart("tool-invocation")
  }
  const text =
    part.type === "tool-invocation"
      ? `\`\`\`json\n${toolRecordJson(part)}\n\`\`\``
      : part.text
  return { type: to, text }
}

export function convertPartsToRole(
  parts: Parts,
  role: ConversationAuthorRole
): Parts {
  if (role === "assistant") {
    const next = parts.filter((part) => part.type !== "attachment")
    return next.length > 0 ? next : [{ type: "text", text: "" }]
  }
  const chunks: string[] = []
  for (const part of parts) {
    if (part.type === "text" || part.type === "reasoning") {
      if (part.text.trim()) chunks.push(part.text)
      continue
    }
    if (part.type === "tool-invocation") {
      chunks.push(`\`\`\`json\n${toolRecordJson(part)}\n\`\`\``)
    }
  }
  return [{ type: "text", text: chunks.join("\n\n") }]
}

export function roleConversionLosses(
  parts: Parts,
  from: ConversationAuthorRole,
  to: ConversationAuthorRole
): string[] {
  if (from === to) return []
  if (to === "assistant") {
    const count = parts.filter((part) => part.type === "attachment").length
    return count > 0
      ? [
          count === 1
            ? "1 attachment will be removed."
            : `${count} attachments will be removed.`,
        ]
      : []
  }
  const losses: string[] = []
  const reasoning = parts.filter((part) => part.type === "reasoning").length
  const tools = parts.filter((part) => part.type === "tool-invocation").length
  const extras = parts.length > 1
  if (extras)
    losses.push("Blocks will collapse into a single text message.")
  if (reasoning)
    losses.push("Reasoning becomes ordinary text.")
  if (tools)
    losses.push(
      tools === 1
        ? "1 tool record will be inlined as JSON text."
        : `${tools} tool records will be inlined as JSON text.`
    )
  return losses
}

export function dropEmptyTextLikeParts(parts: Parts): Parts {
  return parts.filter((part) => {
    if (part.type === "text" || part.type === "reasoning")
      return part.text.length > 0
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
