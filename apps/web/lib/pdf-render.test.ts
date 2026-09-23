import { describe, expect, it } from "vitest"
import { countPdfPages, renderPdfPages } from "@/lib/pdf-render"

function vectorPdf(pageCount: number) {
  const pageObjects: string[] = []
  const kids: string[] = []
  for (let page = 0; page < pageCount; page += 1) {
    const pageObject = 3 + page * 2
    const streamObject = pageObject + 1
    kids.push(`${pageObject} 0 R`)
    const content = `q ${page % 2} 0 0 rg 8 8 56 56 re f Q\n`
    pageObjects.push(
      `${pageObject} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> /Contents ${streamObject} 0 R >>\nendobj\n`,
      `${streamObject} 0 obj\n<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream\nendobj\n`
    )
  }
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    `2 0 obj\n<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pageCount} >>\nendobj\n`,
    ...pageObjects,
  ]
  let body = "%PDF-1.4\n"
  const offsets = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body))
    body += object
  }
  const xrefOffset = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1))
    body += `${String(offset).padStart(10, "0")} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return new Uint8Array(Buffer.from(body))
}

describe("PDF page rendering", () => {
  it("counts pages and renders vector content to PNG images", async () => {
    const pdf = vectorPdf(2)
    expect(await countPdfPages(new Uint8Array(pdf))).toBe(2)

    const images = await renderPdfPages(new Uint8Array(pdf))
    expect(images).toHaveLength(2)
    for (const image of images) {
      expect([...image.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    }
  })
})
