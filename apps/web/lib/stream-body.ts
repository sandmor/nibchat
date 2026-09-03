import { z } from "zod"
import { attachmentReferenceSchema } from "@/lib/agent/parts"
import { isSupportedTimeZone } from "@/lib/prompt-macros"

const timeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine(isSupportedTimeZone, "Unsupported time zone")

export const streamBodySchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("continue"),
    chatId: z.string().min(1),
    parentNodeId: z.string().nullish(),
    content: z.string(),
    /** Resource references resolved and snapshotted by the server at send time. */
    attachments: z.array(attachmentReferenceSchema).max(20).optional(),
    /** User-edit: copy matching MCP snapshots from this sibling instead of re-reading. */
    editedFromNodeId: z.string().min(1).optional(),
    /** Linear user-edit: persist the new turn as the selected path. */
    attachSelection: z.boolean().optional(),
    timeZone: timeZoneSchema,
  }),
  z.object({
    intent: z.literal("regenerate"),
    chatId: z.string().min(1),
    assistantNodeId: z.string().min(1),
    timeZone: timeZoneSchema,
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
    timeZone: timeZoneSchema,
  }),
])

export type StreamBody = z.infer<typeof streamBodySchema>
