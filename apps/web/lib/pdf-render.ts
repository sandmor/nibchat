import "server-only"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas"

const MAX_PAGE_EDGE = 2000

type CanvasAndContext = ReturnType<PdfCanvasFactory["create"]>

class PdfCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height)
    return { canvas, context: canvas.getContext("2d") }
  }

  reset(canvasAndContext: CanvasAndContext, width: number, height: number) {
    canvasAndContext.canvas.width = width
    canvasAndContext.canvas.height = height
    canvasAndContext.context = canvasAndContext.canvas.getContext("2d")
  }

  destroy(canvasAndContext: CanvasAndContext) {
    canvasAndContext.canvas.width = 0
    canvasAndContext.canvas.height = 0
  }
}

let pdfjsPromise:
  | Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>
  | undefined

function loadPdfjs() {
  if (!globalThis.DOMMatrix) {
    Object.defineProperty(globalThis, "DOMMatrix", { value: DOMMatrix })
  }
  if (!globalThis.ImageData) {
    Object.defineProperty(globalThis, "ImageData", { value: ImageData })
  }
  if (!globalThis.Path2D) {
    Object.defineProperty(globalThis, "Path2D", { value: Path2D })
  }
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs")
  return pdfjsPromise
}

function resolvePdfjsRoot() {
  const roots = [
    join(process.cwd(), "node_modules/pdfjs-dist"),
    join(process.cwd(), "apps/web/node_modules/pdfjs-dist"),
  ]
  const root = roots.find((candidate) =>
    existsSync(join(candidate, "standard_fonts"))
  )
  if (root) return root
  throw new Error("PDF.js runtime files could not be located")
}

const pdfjsRoot = resolvePdfjsRoot()

async function openPdf(data: Uint8Array) {
  const { getDocument } = await loadPdfjs()
  return getDocument({
    data,
    cMapUrl: `${join(pdfjsRoot, "cmaps")}/`,
    cMapPacked: true,
    standardFontDataUrl: `${join(pdfjsRoot, "standard_fonts")}/`,
    useSystemFonts: true,
    CanvasFactory: PdfCanvasFactory,
  })
}

export async function countPdfPages(data: Uint8Array) {
  const loadingTask = await openPdf(data)
  try {
    const document = await loadingTask.promise
    return document.numPages
  } finally {
    await loadingTask.destroy()
  }
}

export async function renderPdfPages(data: Uint8Array) {
  const loadingTask = await openPdf(data)
  try {
    const document = await loadingTask.promise
    const images: Uint8Array[] = []
    const canvasFactory = document.canvasFactory as {
      create(
        width: number,
        height: number
      ): {
        canvas: { toBuffer(mime: "image/png"): Uint8Array }
        context: unknown
      }
      destroy(canvas: { canvas: unknown; context: unknown }): void
    }

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const baseViewport = page.getViewport({ scale: 1 })
      const scale =
        MAX_PAGE_EDGE / Math.max(baseViewport.width, baseViewport.height)
      const viewport = page.getViewport({ scale: Math.min(2, scale) })
      const width = Math.max(1, Math.ceil(viewport.width))
      const height = Math.max(1, Math.ceil(viewport.height))
      const canvasAndContext = canvasFactory.create(width, height)

      try {
        await page.render({
          canvasContext: canvasAndContext.context as never,
          viewport,
          background: "#ffffff",
        }).promise
        images.push(
          new Uint8Array(canvasAndContext.canvas.toBuffer("image/png"))
        )
      } finally {
        canvasFactory.destroy(canvasAndContext)
        page.cleanup()
      }
    }

    return images
  } finally {
    await loadingTask.destroy()
  }
}
