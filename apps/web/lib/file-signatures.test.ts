import { describe, expect, it } from "vitest"
import { validateAttachmentSignature } from "@/lib/file-signatures"

describe("attachment signatures", () => {
  it("accepts PDFs and canonicalizes octet-stream uploads", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
    expect(validateAttachmentSignature(pdf, "application/pdf")).toBe(
      "application/pdf"
    )
    expect(validateAttachmentSignature(pdf, "application/octet-stream")).toBe(
      "application/pdf"
    )
  })

  it("rejects a declared type that disagrees with the bytes", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])
    expect(() => validateAttachmentSignature(pdf, "image/png")).toThrow(
      "valid JPEG, PNG, WebP, GIF, or PDF"
    )
  })
})
