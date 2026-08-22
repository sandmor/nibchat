import type { AttachmentContent, Parts } from "@/lib/types"

type DocumentAnalysis = Extract<
  AttachmentContent,
  { kind: "document" }
>["analysis"]

export function pdfAttachmentCaption(analysis: DocumentAnalysis): string {
  const pages =
    analysis.pageCount != null
      ? `${analysis.pageCount} page${analysis.pageCount === 1 ? "" : "s"}`
      : null
  if (analysis.status === "ready") return pages ?? "PDF"
  const unread =
    analysis.status === "no-text" ? "Couldn't read text" : "Text unavailable"
  if (!pages) return unread
  return `${pages} · ${unread.charAt(0).toLowerCase()}${unread.slice(1)}`
}

export function assertPdfFallbackAvailable(parts: Parts) {
  for (const part of parts) {
    if (part.type !== "attachment" || part.content.kind !== "document") continue
    if (part.content.analysis.status === "ready") continue
    throw new Error(
      `"${part.name}" has no readable text. Choose a model that accepts PDF files.`
    )
  }
}
