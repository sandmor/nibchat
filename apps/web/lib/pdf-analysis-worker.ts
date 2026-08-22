import init, { processPdf } from "@firecrawl/pdf-inspector-wasm"
import { MAX_ATTACHMENT_TEXT_CHARS } from "@/lib/types"
import type { PdfAnalysis } from "@/lib/pdf-analysis"

type WorkerRequest = { id: string; data: ArrayBuffer }
type PdfResult = {
  pdfType?: "TextBased" | "Scanned" | "ImageBased" | "Mixed"
  pageCount?: number
  markdown?: string | null
}

let initialized: Promise<unknown> | null = null

function load() {
  initialized ??= init()
  return initialized
}

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const { id, data } = event.data
  try {
    await load()
    const result = processPdf(new Uint8Array(data)) as unknown as PdfResult
    const pageCount = result.pageCount
    const pdfType = result.pdfType
    const markdown = result.markdown?.trim()
    let analysis: PdfAnalysis
    if (!markdown || !pageCount || !pdfType) {
      analysis = {
        version: 1,
        status: "no-text",
        ...(pdfType ? { pdfType } : {}),
        ...(pageCount ? { pageCount } : {}),
      }
    } else if (markdown.length > MAX_ATTACHMENT_TEXT_CHARS) {
      analysis = {
        version: 1,
        status: "ready",
        pdfType,
        pageCount,
        markdown: markdown.slice(0, MAX_ATTACHMENT_TEXT_CHARS),
      }
    } else {
      analysis = { version: 1, status: "ready", pdfType, pageCount, markdown }
    }
    self.postMessage({ id, analysis })
  } catch {
    self.postMessage({
      id,
      analysis: { version: 1, status: "failed" } satisfies PdfAnalysis,
    })
  }
})
