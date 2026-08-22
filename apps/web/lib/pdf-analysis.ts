import { z } from "zod"
import { MAX_ATTACHMENT_TEXT_CHARS } from "@/lib/types"

const pdfTypeSchema = z.enum(["TextBased", "Scanned", "ImageBased", "Mixed"])

export const pdfAnalysisSchema = z.discriminatedUnion("status", [
  z.object({
    version: z.literal(1),
    status: z.literal("ready"),
    pdfType: pdfTypeSchema,
    pageCount: z.number().int().positive(),
    markdown: z.string().min(1).max(MAX_ATTACHMENT_TEXT_CHARS),
  }),
  z.object({
    version: z.literal(1),
    status: z.enum(["no-text", "failed", "unavailable"]),
    pdfType: pdfTypeSchema.optional(),
    pageCount: z.number().int().positive().optional(),
  }),
])

export type PdfAnalysis = z.infer<typeof pdfAnalysisSchema>

export function pdfAnalysisFromRow(raw?: string) {
  if (!raw) return { status: "unavailable" } as const
  try {
    const analysis = pdfAnalysisSchema.parse(JSON.parse(raw))
    const { version, ...content } = analysis
    void version
    return content
  } catch {
    return { status: "unavailable" } as const
  }
}
