import "server-only"
import { parseJson } from "@/lib/domain"
import {
  buildModelMessages,
  type EmbeddedBinaryAttachment,
} from "@/lib/agent/build-messages"
import type { Parts } from "@/lib/agent/parts"
import { getAttachedAttachment, readAttachment } from "@/lib/attachments"
import type { NodeRow } from "@/lib/types"

/**
 * Generation path: load image bytes and embed them as file parts.
 */
export async function buildEmbeddedModelMessages(options: {
  nodes: NodeRow[]
  replayReasoning: boolean
  pdfInputMode: "native" | "extracted"
}) {
  const binaries = new Map<string, EmbeddedBinaryAttachment>()
  for (const node of options.nodes) {
    if (node.excluded_from_context) continue
    if (node.status === "error" && !node.search_text) continue
    const parts = parseJson<Parts>(node.parts_json, [])
    for (const part of parts) {
      if (
        part.type !== "attachment" ||
        part.content.kind === "text" ||
        (part.content.kind === "document" &&
          options.pdfInputMode === "extracted")
      )
        continue
      const row = await getAttachedAttachment(part.content.attachmentId)
      binaries.set(part.id, {
        type: "file",
        filename: row.filename,
        mediaType: row.media_type,
        data: { type: "data", data: await readAttachment(row) },
      })
    }
  }
  return buildModelMessages({
    nodes: options.nodes,
    replayReasoning: options.replayReasoning,
    pdfInputMode: options.pdfInputMode,
    resolveBinaryAttachment: (part) => {
      const file = binaries.get(part.id)
      if (!file) throw new Error(`Attachment ${part.id} was not loaded`)
      return file
    },
  })
}
