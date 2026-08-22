import { ancestorPath, parseJson } from "@/lib/domain"
import type { NodeRow, Parts, ToolInvocationPart } from "@/lib/types"

/**
 * Visible markdown for one message: prose, attachments, and tools.
 * Reasoning stays out — it is internal and collapsed in the UI.
 */
export function messageToMarkdown(node: NodeRow): string {
  return partsToMarkdown(parseJson<Parts>(node.parts_json, []))
}

/**
 * Transcript of this node's ancestor lineage (root → node).
 *
 * Uses parent pointers, not the chat's selected branch. Tree cards that sit
 * off the Linear path still copy the conversation that produced them.
 */
export function pathToMarkdown(nodes: NodeRow[], nodeId: string): string {
  return ancestorPath(nodes, nodeId)
    .map((node) => {
      const body = messageToMarkdown(node)
      if (!body) return null
      return `**${roleLabel(node.role)}**\n\n${body}`
    })
    .filter((section): section is string => section != null)
    .join("\n\n")
}

export function partsToMarkdown(parts: Parts): string {
  const sections: string[] = []
  let textBuffer = ""

  const flushText = () => {
    if (!textBuffer) return
    sections.push(textBuffer)
    textBuffer = ""
  }

  for (const part of parts) {
    if (part.type === "text") {
      textBuffer += part.text
      continue
    }
    if (part.type === "reasoning") continue
    flushText()
    if (part.type === "attachment") {
      if (part.content.kind === "text") {
        sections.push(`**Attachment: ${part.name}**\n\n${part.content.text}`)
      } else if (part.content.kind === "document") {
        sections.push(`*[PDF: ${part.name}]*`)
      } else {
        sections.push(`*[Image: ${part.name}]*`)
      }
      continue
    }
    if (part.type === "tool-invocation") {
      const tool = toolToMarkdown(part)
      if (tool) sections.push(tool)
    }
  }
  flushText()
  return sections.join("\n\n").trim()
}

function roleLabel(role: string): string {
  if (!role) return "Message"
  return role.charAt(0).toUpperCase() + role.slice(1)
}

function toolToMarkdown(part: ToolInvocationPart): string {
  const blocks = [`**Tool: ${part.toolName}**`]
  if (part.input !== undefined) {
    const input = formatValue(part.input)
    if (input) blocks.push(`Input:\n\n${input}`)
  }
  if (part.state === "output-error" && part.errorText) {
    blocks.push(`Error:\n\n${part.errorText}`)
  } else if (part.output !== undefined) {
    const output = formatValue(part.output)
    if (output) blocks.push(`Output:\n\n${output}`)
  }
  return blocks.join("\n\n")
}

function formatValue(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  try {
    return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
  } catch {
    return String(value)
  }
}
