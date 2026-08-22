"use client"

import type { PdfAnalysis } from "@/lib/pdf-analysis"

export async function analyzePdf(file: File): Promise<PdfAnalysis> {
  let data: ArrayBuffer
  try {
    data = await file.arrayBuffer()
  } catch {
    return { version: 1, status: "failed" }
  }
  return new Promise((resolve) => {
    const id = crypto.randomUUID()
    const worker = new Worker(
      new URL("./pdf-analysis-worker.ts", import.meta.url),
      {
        type: "module",
      }
    )
    const close = () => worker.terminate()
    worker.addEventListener("message", (event: MessageEvent) => {
      if (event.data?.id !== id) return
      close()
      resolve(event.data.analysis as PdfAnalysis)
    })
    worker.addEventListener("error", () => {
      close()
      resolve({ version: 1, status: "failed" })
    })
    try {
      worker.postMessage({ id, data })
    } catch {
      close()
      resolve({ version: 1, status: "failed" })
    }
  })
}
