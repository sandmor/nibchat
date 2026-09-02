import type { ModelMessage } from "ai"
import { parseJson } from "@/lib/domain"
import {
  attachmentModelText,
  isToolInvocationPart,
  type AttachmentPart,
  type Parts,
} from "@/lib/agent/parts"
import type { NodeRow, ToolInvocationPart } from "@/lib/types"
import type { ResponsesReplayTarget } from "@/lib/providers"

function nodePartsLocal(node: NodeRow): Parts {
  return parseJson<Parts>(node.parts_json, [])
}

export type EmbeddedBinaryAttachment = {
  type: "file"
  filename: string
  mediaType: string
  data: { type: "data"; data: Uint8Array }
}

/** Return file bytes, or `"placeholder"` to send `[Image attachment: name]`. */
export type ResolveBinaryAttachment = (
  part: AttachmentPart
) => EmbeddedBinaryAttachment | "placeholder"

export type BuildMessagesOptions = {
  nodes: NodeRow[]
  replayReasoning: boolean
  /** Responses metadata is replayable only to its originating provider/model. */
  responsesReplay?: ResponsesReplayTarget
  pdfInputMode?: "native" | "extracted"
  resolveBinaryAttachment?: ResolveBinaryAttachment
}

/**
 * Convert tree context nodes into AI SDK model messages, expanding
 * tool-invocation parts into assistant tool-call + tool-result turns.
 * Binary attachments default to placeholders (safe for client preview).
 */
export function buildModelMessages(
  options: BuildMessagesOptions
): ModelMessage[] {
  const messages: ModelMessage[] = []
  const resolveBinary =
    options.resolveBinaryAttachment ?? (() => "placeholder" as const)

  for (const node of options.nodes) {
    if (node.excluded_from_context) continue
    if (node.status === "error" && !node.search_text) continue
    const metadata = parseJson<Record<string, unknown>>(node.metadata_json, {})
    const parts = filterPartsForModel(node, nodePartsLocal(node), {
      replayReasoning: options.replayReasoning,
      metadata,
      responsesReplay: options.responsesReplay,
    })
    if (parts.length === 0) continue

    if (node.role === "system") {
      const text = parts
        .filter((p) => p.type === "text" || p.type === "reasoning")
        .map((p) => ("text" in p ? p.text : ""))
        .join("\n")
      if (text) messages.push({ role: "system", content: text })
      continue
    }

    if (node.role === "user") {
      const content: Array<
        { type: "text"; text: string } | EmbeddedBinaryAttachment
      > = []
      for (const part of parts) {
        if (part.type === "text" && part.text) {
          content.push({ type: "text", text: part.text })
        } else if (part.type === "attachment") {
          if (part.content.kind === "text") {
            content.push({ type: "text", text: attachmentModelText(part) })
          } else if (
            part.content.kind === "document" &&
            options.pdfInputMode === "extracted"
          ) {
            content.push({ type: "text", text: attachmentModelText(part) })
          } else {
            const resolved = resolveBinary(part)
            if (resolved === "placeholder") {
              content.push({
                type: "text",
                // A native PDF contributes its bytes, not extracted markdown.
                // Client-only callers use this placeholder because they cannot
                // embed the file, so preserve that same context footprint.
                text:
                  part.content.kind === "document"
                    ? `[PDF attachment: ${part.name}]`
                    : attachmentModelText(part),
              })
            } else {
              content.push(resolved)
            }
          }
        }
      }
      if (content.length > 0) messages.push({ role: "user", content })
      continue
    }

    if (node.role === "assistant") {
      appendAssistantWithTools(messages, parts, {
        metadata,
        responsesReplay: options.responsesReplay,
      })
    }
  }

  return messages
}

function filterPartsForModel(
  node: NodeRow,
  parts: Parts,
  opts: {
    replayReasoning: boolean
    metadata: Record<string, unknown>
    responsesReplay?: ResponsesReplayTarget
  }
): Parts {
  return parts.filter((part) => {
    if (part.type === "text") return true
    if (part.type === "attachment") return true
    if (part.type === "tool-invocation") return true
    if (part.type !== "reasoning") return false
    return (
      opts.replayReasoning &&
      node.role === "assistant" &&
      opts.metadata.provenance !== "owner-edited"
    )
  })
}

/**
 * One assistant node may contain interleaved text/reasoning/tools.
 * We emit assistant tool-calls then tool-result messages for completed tools.
 */
function appendAssistantWithTools(
  messages: ModelMessage[],
  parts: Parts,
  context: {
    metadata: Record<string, unknown>
    responsesReplay?: ResponsesReplayTarget
  }
) {
  type AssistantChunk =
    | {
        type: "reasoning"
        text: string
        providerOptions?: Record<string, unknown>
      }
    | { type: "text"; text: string; providerOptions?: Record<string, unknown> }
    | {
        type: "tool-call"
        toolCallId: string
        toolName: string
        input: unknown
        providerOptions?: Record<string, unknown>
      }

  let assistantContent: AssistantChunk[] = []
  const flushAssistant = () => {
    if (assistantContent.length === 0) return
    messages.push({
      role: "assistant",
      content: assistantContent.map((chunk) => {
        if (chunk.type === "reasoning") {
          const providerOptions = sanitizeProviderMetadata(
            chunk.providerOptions,
            context
          )
          return {
            type: "reasoning" as const,
            text: chunk.text,
            ...(providerOptions ? { providerOptions } : {}),
          }
        }
        if (chunk.type === "text") {
          const providerOptions = sanitizeProviderMetadata(
            chunk.providerOptions,
            context
          )
          return {
            type: "text" as const,
            text: chunk.text,
            ...(providerOptions ? { providerOptions } : {}),
          }
        }
        const providerOptions = sanitizeProviderMetadata(
          chunk.providerOptions,
          context
        )
        return {
          type: "tool-call" as const,
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          input: chunk.input,
          ...(providerOptions ? { providerOptions } : {}),
        }
      }) as never,
    })
    assistantContent = []
  }

  const pendingResults: ToolInvocationPart[] = []
  const flushToolResults = () => {
    if (pendingResults.length === 0) return
    messages.push({
      role: "tool",
      content: pendingResults.map((toolPart) => ({
        type: "tool-result" as const,
        toolCallId: toolPart.toolCallId,
        toolName: toolPart.toolName,
        output: {
          type: "text" as const,
          value: toolResultText(toolPart),
        },
      })),
    })
    pendingResults.length = 0
  }

  for (const part of parts) {
    if (part.type === "reasoning") {
      flushToolResults()
      assistantContent.push({
        type: "reasoning",
        text: part.text,
        ...(part.providerMetadata
          ? { providerOptions: part.providerMetadata }
          : {}),
      })
      continue
    }
    if (part.type === "text") {
      flushToolResults()
      assistantContent.push({
        type: "text",
        text: part.text,
        ...(part.providerMetadata
          ? { providerOptions: part.providerMetadata }
          : {}),
      })
      continue
    }
    if (isToolInvocationPart(part)) {
      assistantContent.push({
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        providerOptions: part.providerMetadata,
      })
      if (part.state === "output-available" || part.state === "output-error") {
        pendingResults.push(part)
        flushAssistant()
        flushToolResults()
      }
    }
  }
  flushAssistant()
}

function sanitizeProviderMetadata(
  value: Record<string, unknown> | undefined,
  context: {
    metadata: Record<string, unknown>
    responsesReplay?: ResponsesReplayTarget
  }
) {
  if (!value) return undefined
  if (!isReplayOrigin(context)) return undefined
  const sourceKey = context.metadata.responsesProviderOptionsKey
  if (typeof sourceKey !== "string" || !context.responsesReplay)
    return undefined
  const source = value[sourceKey]
  return source === undefined
    ? undefined
    : { [context.responsesReplay.providerOptionsKey]: source }
}

function isReplayOrigin(context: {
  metadata: Record<string, unknown>
  responsesReplay?: ResponsesReplayTarget
}) {
  if (context.metadata.provenance === "owner-edited") return false
  return (
    context.metadata.provider === context.responsesReplay?.providerId &&
    context.metadata.model === context.responsesReplay?.model
  )
}

function toolResultText(toolPart: ToolInvocationPart): string {
  if (toolPart.state === "output-error")
    return toolPart.errorText ?? "Tool execution failed."
  if (toolPart.output == null) return ""
  if (typeof toolPart.output === "string") return toolPart.output
  if (
    typeof toolPart.output === "object" &&
    toolPart.output !== null &&
    "output" in toolPart.output &&
    typeof (toolPart.output as { output: unknown }).output === "string"
  ) {
    return (toolPart.output as { output: string }).output
  }
  return JSON.stringify(toolPart.output)
}
