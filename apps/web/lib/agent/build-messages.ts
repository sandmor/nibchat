import type { ModelMessage } from "ai"
import { parseJson } from "@/lib/domain"
import { isToolInvocationPart, type Parts } from "@/lib/agent/parts"
import type { NodeRow, ToolInvocationPart } from "@/lib/types"

function nodePartsLocal(node: NodeRow): Parts {
  return parseJson<Parts>(node.parts_json, [])
}

export type BuildMessagesOptions = {
  nodes: NodeRow[]
  replayReasoning: boolean
}

/**
 * Convert tree context nodes into AI SDK model messages, expanding
 * tool-invocation parts into assistant tool-call + tool-result turns.
 */
export function buildModelMessages(
  options: BuildMessagesOptions
): ModelMessage[] {
  const messages: ModelMessage[] = []

  for (const node of options.nodes) {
    if (node.status === "error" && !node.search_text) continue
    const metadata = parseJson<Record<string, unknown>>(node.metadata_json, {})
    const parts = filterPartsForModel(node, nodePartsLocal(node), {
      replayReasoning: options.replayReasoning,
      metadata,
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
      const content = parts
        .filter((p) => p.type === "text")
        .map((p) => ({ type: "text" as const, text: p.text }))
      if (content.length > 0) messages.push({ role: "user", content })
      continue
    }

    if (node.role === "assistant") {
      appendAssistantWithTools(messages, parts)
    }
    // tool role reserved; not used for path storage in v1
  }

  return messages
}

function filterPartsForModel(
  node: NodeRow,
  parts: Parts,
  opts: {
    replayReasoning: boolean
    metadata: Record<string, unknown>
  }
): Parts {
  return parts.filter((part) => {
    if (part.type === "text") return true
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
function appendAssistantWithTools(messages: ModelMessage[], parts: Parts) {
  type AssistantChunk =
    | { type: "reasoning"; text: string }
    | { type: "text"; text: string }
    | {
        type: "tool-call"
        toolCallId: string
        toolName: string
        input: unknown
      }

  let assistantContent: AssistantChunk[] = []
  const flushAssistant = () => {
    if (assistantContent.length === 0) return
    messages.push({
      role: "assistant",
      content: assistantContent.map((chunk) => {
        if (chunk.type === "reasoning")
          return { type: "reasoning" as const, text: chunk.text }
        if (chunk.type === "text")
          return { type: "text" as const, text: chunk.text }
        return {
          type: "tool-call" as const,
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          input: chunk.input,
        }
      }),
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
      assistantContent.push({ type: "reasoning", text: part.text })
      continue
    }
    if (part.type === "text") {
      flushToolResults()
      assistantContent.push({ type: "text", text: part.text })
      continue
    }
    if (isToolInvocationPart(part)) {
      assistantContent.push({
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
      })
      if (
        part.state === "output-available" ||
        part.state === "output-error"
      ) {
        pendingResults.push(part)
        flushAssistant()
        flushToolResults()
      }
    }
  }
  flushAssistant()
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
