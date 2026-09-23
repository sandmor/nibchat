import "server-only"
import { parseJson } from "@/lib/domain"
import {
  buildModelMessages,
  type EmbeddedBinaryAttachment,
} from "@/lib/agent/build-messages"
import type { Parts } from "@/lib/agent/parts"
import { getAttachedAttachment, readAttachment } from "@/lib/attachments"
import { countPdfPages, renderPdfPages } from "@/lib/pdf-render"
import type { NodeRow } from "@/lib/types"
import type { ResponsesReplayTarget } from "@/lib/providers"
import type { PdfInputMode } from "@/lib/provider-models"
import { assertPdfImagePageLimit } from "@/lib/pdf-input"

/**
 * Generation path: load image bytes and embed them as file parts.
 */
export async function buildEmbeddedModelMessages(options: {
  nodes: NodeRow[]
  replayReasoning: boolean
  responsesReplay?: ResponsesReplayTarget
  pdfInputMode: PdfInputMode
  pdfImagePageLimit: number
}) {
  const pdfPageCounts = new Map<string, number>()
  let totalPdfPages = 0

  if (options.pdfInputMode === "images") {
    for (const node of options.nodes) {
      if (node.role !== "user") continue
      if (node.excluded_from_context) continue
      if (node.status === "error" && !node.search_text) continue
      const parts = parseJson<Parts>(node.parts_json, [])
      for (const part of parts) {
        if (part.type !== "attachment" || part.content.kind !== "document")
          continue
        let pageCount = pdfPageCounts.get(part.content.attachmentId)
        if (pageCount === undefined) {
          const row = await getAttachedAttachment(part.content.attachmentId)
          try {
            pageCount = await countPdfPages(await readAttachment(row))
          } catch {
            throw new Error(`Could not inspect pages in "${part.name}"`)
          }
          pdfPageCounts.set(part.content.attachmentId, pageCount)
        }
        totalPdfPages += pageCount
      }
    }

    assertPdfImagePageLimit(totalPdfPages, options.pdfImagePageLimit)
  }

  const binaries = new Map<
    string,
    EmbeddedBinaryAttachment | EmbeddedBinaryAttachment[]
  >()
  const renderedPages = new Map<string, EmbeddedBinaryAttachment[]>()
  for (const node of options.nodes) {
    if (node.role !== "user") continue
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
      if (
        part.content.kind === "document" &&
        options.pdfInputMode === "images"
      ) {
        let pages = renderedPages.get(part.content.attachmentId)
        if (!pages) {
          const row = await getAttachedAttachment(part.content.attachmentId)
          try {
            const images = await renderPdfPages(await readAttachment(row))
            pages = images.map((data, index) => ({
              type: "file",
              filename: `${row.filename} page ${index + 1}.png`,
              mediaType: "image/png",
              data: { type: "data", data },
            }))
          } catch {
            throw new Error(`Could not render "${part.name}" pages as images`)
          }
          renderedPages.set(part.content.attachmentId, pages)
        }
        binaries.set(part.id, pages)
      } else {
        const row = await getAttachedAttachment(part.content.attachmentId)
        binaries.set(part.id, {
          type: "file",
          filename: row.filename,
          mediaType: row.media_type,
          data: { type: "data", data: await readAttachment(row) },
        })
      }
    }
  }
  return buildModelMessages({
    nodes: options.nodes,
    replayReasoning: options.replayReasoning,
    responsesReplay: options.responsesReplay,
    pdfInputMode: options.pdfInputMode,
    resolveBinaryAttachment: (part) => {
      const file = binaries.get(part.id)
      if (!file) throw new Error(`Attachment ${part.id} was not loaded`)
      return file
    },
  })
}
