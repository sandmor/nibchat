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
      `"${part.name}" has no readable text. Choose a model set to Images or File for PDFs.`
    )
  }
}

export function assertPdfImagePageLimit(pageCount: number, pageLimit: number) {
  if (!Number.isSafeInteger(pageCount) || pageCount < 0)
    throw new Error("PDF page count is invalid")
  if (!Number.isSafeInteger(pageLimit) || pageLimit < 1)
    throw new Error("PDF image page limit must be a positive whole number")
  if (pageCount > pageLimit) {
    throw new Error(
      `This context has ${pageCount} PDF pages, above your ${pageLimit}-page image limit. Increase it in Settings → PDF pages as images, or remove PDFs from the active context.`
    )
  }
}
