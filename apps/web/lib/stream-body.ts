import { z } from "zod"
import { attachmentReferenceSchema } from "@/lib/agent/parts"

export const streamBodySchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("continue"),
    chatId: z.string().min(1),
    parentNodeId: z.string().nullish(),
    content: z.string(),
    /** Resource references resolved and snapshotted by the server at send time. */
    attachments: z.array(attachmentReferenceSchema).max(20).optional(),
  }),
  z.object({
    intent: z.literal("regenerate"),
    chatId: z.string().min(1),
    assistantNodeId: z.string().min(1),
  }),
  z.object({
    intent: z.literal("generate"),
    chatId: z.string().min(1),
    parentNodeId: z.string().min(1),
  }),
  z.object({
    intent: z.literal("resume"),
    chatId: z.string().min(1),
    assistantNodeId: z.string().min(1),
    toolResults: z
      .array(
        z.object({
          toolCallId: z.string().min(1),
          /** Structured tool output (for question: answers arrays or formatted result). */
          output: z.unknown(),
        })
      )
      .min(1),
  }),
])

export type StreamBody = z.infer<typeof streamBodySchema>
