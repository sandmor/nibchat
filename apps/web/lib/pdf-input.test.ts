import { describe, expect, it } from "vitest"
import {
  assertPdfFallbackAvailable,
  pdfAttachmentCaption,
} from "@/lib/pdf-input"
import type { Parts } from "@/lib/types"

const pdf = (status: "ready" | "failed"): Parts => [
  {
    type: "attachment",
    id: "pdf-1",
    name: "report.pdf",
    source: { kind: "upload" },
    content:
      status === "ready"
        ? {
            kind: "document",
            attachmentId: "pdf-1",
            mediaType: "application/pdf",
            byteSize: 10,
            sha256: "a".repeat(64),
            analysis: {
              status: "ready",
              pdfType: "TextBased",
              pageCount: 1,
              markdown: "Report",
            },
          }
        : {
            kind: "document",
            attachmentId: "pdf-1",
            mediaType: "application/pdf",
            byteSize: 10,
            sha256: "a".repeat(64),
            analysis: { status: "failed" },
          },
  },
]

describe("PDF fallback preflight", () => {
  it("accepts extracted PDFs and rejects PDFs without fallback text", () => {
    expect(() => assertPdfFallbackAvailable(pdf("ready"))).not.toThrow()
    expect(() => assertPdfFallbackAvailable(pdf("failed"))).toThrow(
      "report.pdf"
    )
  })
})

describe("pdfAttachmentCaption", () => {
  it("names pages when text is ready and explains unread scans", () => {
    expect(
      pdfAttachmentCaption({
        status: "ready",
        pdfType: "TextBased",
        pageCount: 12,
        markdown: "ok",
      })
    ).toBe("12 pages")
    expect(
      pdfAttachmentCaption({
        status: "ready",
        pdfType: "TextBased",
        pageCount: 1,
        markdown: "ok",
      })
    ).toBe("1 page")
    expect(pdfAttachmentCaption({ status: "no-text", pageCount: 3 })).toBe(
      "3 pages · couldn't read text"
    )
    expect(pdfAttachmentCaption({ status: "failed" })).toBe("Text unavailable")
  })
})
