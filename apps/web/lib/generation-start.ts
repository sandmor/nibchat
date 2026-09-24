import { z } from "zod"
import { attachmentReferenceSchema } from "@/lib/agent/parts"
import { isSupportedTimeZone } from "@/lib/prompt-macros"
import { MAX_COLLECTION } from "@/lib/limits"
import type { GenerationPayload } from "@/lib/generation-streams/events"

const timeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine(isSupportedTimeZone, "Unsupported time zone")
const replyCountSchema = z.number().int().min(1).max(MAX_COLLECTION)

/** One client action may start sibling replies; resume continues one existing assistant. */
export const generationStartSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("submit"),
    actionId: z.uuid(),
    replyCount: replyCountSchema.optional(),
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
    intent: z.literal("generate"),
    actionId: z.uuid(),
    replyCount: replyCountSchema.optional(),
    chatId: z.string().min(1),
    /** The selected context message. Null starts from an empty conversation. */
    parentNodeId: z.string().nullish(),
    attachSelection: z.boolean().optional(),
    timeZone: timeZoneSchema,
  }),
  z.object({
    intent: z.literal("resume"),
    actionId: z.uuid(),
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

export type GenerationStartBody = z.infer<typeof generationStartSchema>
export type GenerationStartInput = GenerationStartBody extends infer T
  ? T extends unknown
    ? Omit<T, "timeZone" | "actionId">
    : never
  : never

/** Durable handles returned by one generation start action. */
export const generationBatchResponseSchema = z.object({
  actionId: z.uuid(),
  userNodeId: z.string().min(1).nullable(),
  generations: z
    .array(
      z.object({
        generationId: z.string().min(1),
        assistantNodeId: z.string().min(1),
        parentNodeId: z.string().min(1).nullable(),
      })
    )
    .min(1)
    .max(MAX_COLLECTION),
})
export type GenerationBatchResponse = z.infer<
  typeof generationBatchResponseSchema
>

/** The manifest precedes per-generation events; completion follows every sibling. */
export type ActionStreamEvent =
  | (GenerationBatchResponse & { type: "action-started"; chatId: string })
  | { type: "generation-event"; generationId: string; event: GenerationPayload }
  | { type: "action-finished"; actionId: string }
