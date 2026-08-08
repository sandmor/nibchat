import { z } from "zod"

export const streamBodySchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("continue"),
    chatId: z.string().min(1),
    parentNodeId: z.string().nullish(),
    content: z.string(),
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
])

export type StreamBody = z.infer<typeof streamBodySchema>
