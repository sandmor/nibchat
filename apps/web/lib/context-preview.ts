import { buildModelMessages } from "@/lib/agent/build-messages"
import { searchTextFromParts } from "@/lib/agent/parts"
import { ancestorPath, parseJson } from "@/lib/domain"
import {
  assemblePromptContext,
  isOrphanPromptStackRef,
  resolvePromptStack,
  type AssembledTurn,
  type PromptStackDocument,
  type ResolvePromptStackResult,
} from "@/lib/prompt-stack"
import type { NodeRow, Parts } from "@/lib/types"
import type { PdfAnalysis } from "@/lib/pdf-analysis"
import { idleSinceFromPath, normalizeTimeZone } from "@/lib/prompt-macros"

export const TOKEN_ESTIMATE_TOOLTIP =
  "Approximate. Actual usage depends on model tokenizer."

export type ContextPreviewLayerId = "stack" | "path" | "draft"

export type ContextPreviewLayer = {
  id: ContextPreviewLayerId
  label: string
  messageCount: number
  charCount: number
  estimatedTokens: number
}

export type AssembledContextSummary = {
  messageCount: number
  excludedCount: number
  attachmentCount: number
  imageCount: number
  charCount: number
  estimatedTokens: number
  layers: ContextPreviewLayer[]
}

export type ExcludedMessagePreview = {
  id: string
  role: string
  preview: string
}

export type ContextPreviewWarning = {
  moduleId: string
  message: string
}

export type ContextPreviewDraftInput = {
  text: string
  attachments: Array<{
    name: string
    reference: { kind: string }
    previewUrl?: string
    pdfAnalysis?: PdfAnalysis
  }>
}

export type CompactSegment = {
  text: string
  tooltip?: string
}

const EXCLUDED_WARNING_ID = "__excluded"
const HISTORY_DISABLED_WARNING_ID = "__history-disabled"
const REASONING_REPLAY_WARNING_ID = "__reasoning-replay"
const EXCLUDED_PREVIEW_CHARS = 160

export function estimateTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4)
}

export function modelContentText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part
        if (part && typeof part === "object" && "text" in part)
          return String((part as { text: string }).text)
        if (part && typeof part === "object" && "type" in part)
          return `[${String((part as { type: string }).type)}]`
        return ""
      })
      .filter(Boolean)
      .join("\n")
  }
  if (content == null) return ""
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

export function modelContentChars(content: unknown): number {
  return modelContentText(content).length
}

export function messagesCharCount(
  messages: Array<{ content: unknown }>
): number {
  return messages.reduce(
    (sum, message) => sum + modelContentChars(message.content),
    0
  )
}

export function formatCompactNumber(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) {
    const tenths = Math.round(n / 100) / 10
    return tenths % 1 === 0 ? `${tenths}k` : `${tenths.toFixed(1)}k`
  }
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  const millions = Math.round(n / 100_000) / 10
  return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(1)}M`
}

function isSkippedErrorNode(node: NodeRow): boolean {
  return node.status === "error" && !node.search_text
}

function nodeParts(node: NodeRow): Parts {
  return parseJson<Parts>(node.parts_json, [])
}

function nodePreviewText(node: NodeRow): string {
  const chunks: string[] = []
  for (const part of nodeParts(node)) {
    if (part.type === "text" && part.text) chunks.push(part.text)
    else if (part.type === "attachment") chunks.push(`[${part.name}]`)
  }
  const text = chunks.join(" ").replace(/\s+/g, " ").trim()
  if (text.length <= EXCLUDED_PREVIEW_CHARS) return text
  return `${text.slice(0, EXCLUDED_PREVIEW_CHARS).trimEnd()}…`
}

function layer(
  id: ContextPreviewLayerId,
  label: string,
  messageCount: number,
  charCount: number
): ContextPreviewLayer {
  return {
    id,
    label,
    messageCount,
    charCount,
    estimatedTokens: estimateTokens(charCount),
  }
}

export function summarizeAssembledContext(input: {
  system: string
  turns: AssembledTurn[]
  contextNodes: NodeRow[]
  historyEnabled: boolean
  replayReasoning: boolean
}): {
  summary: AssembledContextSummary
  excludedMessages: ExcludedMessagePreview[]
  extraWarnings: ContextPreviewWarning[]
} {
  const excludedMessages: ExcludedMessagePreview[] = []
  let attachmentCount = 0
  let imageCount = 0
  let editedReasoningDropped = false
  const pathInContext = input.historyEnabled

  for (const node of input.contextNodes) {
    if (node.excluded_from_context) {
      if (pathInContext) {
        excludedMessages.push({
          id: node.id,
          role: node.role,
          preview: nodePreviewText(node),
        })
      }
      continue
    }
    if (isSkippedErrorNode(node)) continue
    if (!pathInContext) continue

    const metadata = parseJson<Record<string, unknown>>(node.metadata_json, {})
    const parts = nodeParts(node)
    if (
      node.role === "assistant" &&
      metadata.provenance === "owner-edited" &&
      parts.some((part) => part.type === "reasoning")
    ) {
      editedReasoningDropped = true
    }
    for (const part of parts) {
      if (part.type !== "attachment") continue
      attachmentCount += 1
      if (part.content.kind === "binary") imageCount += 1
    }
  }

  const pathTurns = input.turns.filter((turn) => turn.source === "path")
  const stackTurns = input.turns.filter((turn) => turn.source === "stack")
  const pathChars = messagesCharCount(pathTurns.map((turn) => turn.message))
  const stackChars =
    input.system.length +
    messagesCharCount(stackTurns.map((turn) => turn.message))
  const charCount =
    input.system.length +
    messagesCharCount(input.turns.map((turn) => turn.message))

  const extraWarnings: ContextPreviewWarning[] = []
  if (!pathInContext && input.contextNodes.length > 0) {
    extraWarnings.push({
      moduleId: HISTORY_DISABLED_WARNING_ID,
      message: "Chat history is disabled for this stack",
    })
  }
  if (excludedMessages.length > 0) {
    extraWarnings.push({
      moduleId: EXCLUDED_WARNING_ID,
      message:
        excludedMessages.length === 1
          ? "1 message excluded from context"
          : `${excludedMessages.length} messages excluded from context`,
    })
  }
  if (input.replayReasoning && editedReasoningDropped) {
    extraWarnings.push({
      moduleId: REASONING_REPLAY_WARNING_ID,
      message: "Reasoning replay disabled for edited branches",
    })
  }

  return {
    summary: {
      messageCount: input.turns.length,
      excludedCount: excludedMessages.length,
      attachmentCount,
      imageCount,
      charCount,
      estimatedTokens: estimateTokens(charCount),
      layers: [
        layer("stack", "Prompt stack", stackTurns.length, stackChars),
        layer("path", "Active path", pathTurns.length, pathChars),
      ],
    },
    excludedMessages,
    extraWarnings,
  }
}

export type AssembledContextPreviewData = {
  source: ResolvePromptStackResult["source"]
  stackId: string | null
  missingStackId?: string
  system: string
  pdfInputMode: "native" | "extracted"
  demotedModuleIds: string[]
  warnings: ContextPreviewWarning[]
  summary: AssembledContextSummary
  excludedMessages: ExcludedMessagePreview[]
}

export type ContextPreviewOverlay = {
  nodeId: string
  parts: Parts
}

export type AssembleContextPreviewInput = {
  nodes: NodeRow[]
  /** Parent the next user message will attach under; ancestors are the path. */
  contextParentId: string | null
  chatStackId: string | null | undefined
  defaultStackId: string | null | undefined
  stacks: ReadonlyArray<{ id: string; stack: PromptStackDocument }>
  replayReasoning: boolean
  /** The selected model receives PDFs either as bytes or extracted text. */
  pdfInputMode?: "native" | "extracted"
  mcpServerInstructionsText?: string
  /** Browser IANA time zone used for prompt macro expansion. */
  timeZone?: string
  /** Time represented by the preview. Defaults to the assembly time. */
  now?: Date
  /**
   * Simulate the sibling `forkEdit` would insert at this node's path
   * position: edited parts, owner-edited provenance, complete and included.
   */
  overlay?: ContextPreviewOverlay
}

function overlayContextNodes(
  nodes: NodeRow[],
  overlay?: ContextPreviewOverlay
): NodeRow[] {
  if (!overlay) return nodes
  return nodes.map((node) => {
    if (node.id !== overlay.nodeId) return node
    const metadata = parseJson<Record<string, unknown>>(node.metadata_json, {})
    return {
      ...node,
      parts_json: JSON.stringify(overlay.parts),
      search_text: searchTextFromParts(overlay.parts),
      excluded_from_context: false,
      status: "complete",
      metadata_json: JSON.stringify({
        ...metadata,
        provenance: "owner-edited",
      }),
    }
  })
}

export function assembleContextPreview(
  input: AssembleContextPreviewInput
): AssembledContextPreviewData {
  const pdfInputMode = input.pdfInputMode ?? "extracted"
  const nodes = overlayContextNodes(input.nodes, input.overlay)
  const stacksById = new Map(
    input.stacks.map((row) => [row.id, row.stack] as const)
  )
  const resolved = resolvePromptStack({
    chatStackId: input.chatStackId,
    defaultStackId: input.defaultStackId,
    stacksById,
  })
  const contextNodes = input.contextParentId
    ? ancestorPath(nodes, input.contextParentId)
    : []
  const pathMessages = buildModelMessages({
    nodes: contextNodes,
    replayReasoning: input.replayReasoning,
    pdfInputMode,
  })
  const assembled = assemblePromptContext({
    stack: resolved.stack,
    pathMessages,
    mcpServerInstructionsText: input.mcpServerInstructionsText,
    macroContext: {
      now: input.now ?? new Date(),
      timeZone: normalizeTimeZone(input.timeZone),
      idleSince: idleSinceFromPath(contextNodes),
    },
  })
  const preview = summarizeAssembledContext({
    system: assembled.system,
    turns: assembled.turns,
    contextNodes,
    historyEnabled: assembled.historyEnabled,
    replayReasoning: input.replayReasoning,
  })
  return {
    source: resolved.source,
    stackId: resolved.stackId,
    missingStackId: isOrphanPromptStackRef(input.chatStackId, input.stacks)
      ? resolved.missingStackId
      : undefined,
    system: assembled.system,
    pdfInputMode,
    demotedModuleIds: assembled.demotedModuleIds,
    warnings: [...assembled.warnings, ...preview.extraWarnings],
    summary: preview.summary,
    excludedMessages: preview.excludedMessages,
  }
}

export function mergeDraftSummary(
  summary: AssembledContextSummary,
  draft: ContextPreviewDraftInput,
  pdfInputMode: "native" | "extracted" = "extracted"
): AssembledContextSummary {
  const draftPdfChars =
    pdfInputMode === "extracted"
      ? draft.attachments.reduce((sum, attachment) => {
          const analysis = attachment.pdfAnalysis
          if (analysis?.status !== "ready") return sum
          return (
            sum +
            `[PDF attachment: ${attachment.name}]\n${analysis.markdown}`.length
          )
        }, 0)
      : 0
  const draftChars = draft.text.length + draftPdfChars
  const draftImages = draft.attachments.filter((item) => item.previewUrl).length
  const draftAttachments = draft.attachments.length
  if (draftChars === 0 && draftAttachments === 0) return summary

  const charCount = summary.charCount + draftChars
  const layers = summary.layers.filter((item) => item.id !== "draft")
  layers.push(
    layer(
      "draft",
      "Draft",
      draftChars > 0 || draftAttachments > 0 ? 1 : 0,
      draftChars
    )
  )
  return {
    ...summary,
    attachmentCount: summary.attachmentCount + draftAttachments,
    imageCount: summary.imageCount + draftImages,
    charCount,
    estimatedTokens: estimateTokens(charCount),
    layers,
  }
}

export function formatCompactSegments(
  summary: AssembledContextSummary
): CompactSegment[] {
  const segments: CompactSegment[] = []
  if (summary.messageCount === 0) {
    segments.push({ text: "System + 0 messages" })
  } else {
    segments.push({
      text: `${summary.messageCount} ${
        summary.messageCount === 1 ? "message" : "messages"
      }`,
    })
  }
  if (summary.excludedCount > 0) {
    segments.push({
      text: `${summary.excludedCount} excluded`,
    })
  }
  if (summary.imageCount > 0) {
    segments.push({
      text: `${summary.imageCount} ${
        summary.imageCount === 1 ? "image" : "images"
      }`,
    })
  }
  const fileCount = summary.attachmentCount - summary.imageCount
  if (fileCount > 0) {
    segments.push({
      text: `${fileCount} ${fileCount === 1 ? "file" : "files"}`,
    })
  }
  segments.push({ text: `~${formatCompactNumber(summary.charCount)} chars` })
  segments.push({
    text: `~${formatCompactNumber(summary.estimatedTokens)} tokens (est.)`,
    tooltip: TOKEN_ESTIMATE_TOOLTIP,
  })
  return segments
}
