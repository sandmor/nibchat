import { generateText } from "ai"
import { TITLE_MAX_CHARS } from "@/lib/chat-title"
import { modelFor, type ModelConfig } from "@/lib/providers"

export const TITLE_GENERATE_TIMEOUT_MS = 8_000
const USER_TEXT_LIMIT = 2_000
const ASSISTANT_TEXT_LIMIT = 1_500

export function sanitizeGeneratedTitle(raw: string) {
  let text = raw.trim().replace(/\s+/g, " ")
  for (const [open, close] of [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
    ["«", "»"],
  ] as const) {
    if (text.startsWith(open) && text.endsWith(close) && text.length > 1) {
      text = text.slice(open.length, -close.length).trim()
    }
  }
  text = text.slice(0, TITLE_MAX_CHARS).trim()
  if (!text) throw new Error("Generated title was empty")
  return text
}

export async function generateChatTitle(input: {
  userId: string
  config: ModelConfig
  userText: string
  assistantText?: string
}) {
  const model = await modelFor(input.userId, input.config, {
    requireConfiguredModel: true,
  })
  const userText = input.userText.trim().slice(0, USER_TEXT_LIMIT)
  const assistantText = input.assistantText
    ?.trim()
    .slice(0, ASSISTANT_TEXT_LIMIT)
  const prompt = assistantText
    ? `User:\n${userText}\n\nAssistant:\n${assistantText}`
    : userText
  const { text } = await generateText({
    model,
    system:
      "Name this chat in a few words. Return only the title. No quotes, colons, or trailing punctuation.",
    prompt: prompt || "Untitled conversation",
    maxOutputTokens: 48,
    temperature: 0.2,
    abortSignal: AbortSignal.timeout(TITLE_GENERATE_TIMEOUT_MS),
  })
  return sanitizeGeneratedTitle(text)
}
