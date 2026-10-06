import { streamText } from "ai"
import { TITLE_MAX_CHARS } from "@/lib/chat-title"
import { DEFAULT_TITLE_INSTRUCTIONS } from "@/lib/chat-settings/catalog"
import { MAX_DESCRIPTION } from "@/lib/limits"
import { modelFor, type ModelConfig } from "@/lib/providers"

const TITLE_GENERATE_TIMEOUT_MS = 8_000

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
  chatId?: string
  branchId?: string
  timeZone?: string
  userText: string
  assistantText?: string
  instructions?: string
}) {
  const model = await modelFor(input.userId, input.config, {
    requireConfiguredModel: true,
    chatId: input.chatId,
    branchId: input.branchId ?? "",
    timeZone: input.timeZone,
    requestKind: "title",
  })
  const userText = input.userText.trim().slice(0, MAX_DESCRIPTION)
  const assistantText = input.assistantText?.trim().slice(0, MAX_DESCRIPTION)
  const prompt = assistantText
    ? `User:\n${userText}\n\nAssistant:\n${assistantText}`
    : userText
  const startedAt = Date.now()
  const controller = new AbortController()
  const firstContentTimer = setTimeout(
    () =>
      controller.abort(
        new DOMException("Title generation timed out", "TimeoutError")
      ),
    TITLE_GENERATE_TIMEOUT_MS
  )
  try {
    const result = streamText({
      abortSignal: controller.signal,
      model,
      system: input.instructions ?? DEFAULT_TITLE_INSTRUCTIONS,
      prompt: prompt || "Untitled conversation",
      temperature: 0.2,
      timeout: {
        firstChunkMs: TITLE_GENERATE_TIMEOUT_MS,
        chunkMs: TITLE_GENERATE_TIMEOUT_MS,
      },
    })
    let text = ""
    let firstContentMs: number | undefined
    for await (const part of result.fullStream) {
      if (part.type === "error") throw part.error
      if (part.type === "abort")
        throw new DOMException("Title generation timed out", "TimeoutError")
      if (
        (part.type === "text-delta" || part.type === "reasoning-delta") &&
        part.text.length > 0
      ) {
        clearTimeout(firstContentTimer)
        firstContentMs ??= Date.now() - startedAt
        if (part.type === "text-delta" && text.length < TITLE_MAX_CHARS)
          text += part.text.slice(0, TITLE_MAX_CHARS - text.length)
      }
    }
    const [finishReason, usage] = await Promise.all([
      result.finishReason,
      result.usage,
    ])
    return {
      title: sanitizeGeneratedTitle(text),
      finishReason,
      firstContentMs,
      durationMs: Date.now() - startedAt,
      usage: {
        ...(usage.inputTokens == null
          ? {}
          : { inputTokens: usage.inputTokens }),
        ...(usage.outputTokens == null
          ? {}
          : { outputTokens: usage.outputTokens }),
        ...(usage.totalTokens == null
          ? {}
          : { totalTokens: usage.totalTokens }),
      },
    }
  } finally {
    clearTimeout(firstContentTimer)
  }
}
