import { z } from "zod"
import { MAX_SCAN_DEPTH } from "@/lib/limits"
import { reasoningPreferencesSchema } from "@/lib/reasoning"

/** null means the entire branch; undefined is reserved for entry inheritance. */
export const scanDepthSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_SCAN_DEPTH)
  .nullable()

export const chatConfigSchema = z.object({
  reasoning: reasoningPreferencesSchema.optional(),
  providerId: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().optional(),
  maxOutputTokens: z.number().optional(),
  topP: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  presencePenalty: z.number().optional(),
  stopSequences: z.array(z.string()).optional(),
  providerOptions: z.record(z.string(), z.unknown()).optional(),
  replayReasoning: z.boolean().optional(),
  contextScanDepth: scanDepthSchema.optional(),
})

export type ChatConfig = z.infer<typeof chatConfigSchema>

/** Shared fallback for old chats and accounts without saved defaults. */
export const DEFAULT_CHAT_CONFIG = { contextScanDepth: 2 } as const

export function parseChatDefaults(json: string | null | undefined) {
  try {
    return {
      ...DEFAULT_CHAT_CONFIG,
      ...chatConfigSchema.parse(JSON.parse(json ?? "{}")),
    }
  } catch {
    return { ...DEFAULT_CHAT_CONFIG }
  }
}
