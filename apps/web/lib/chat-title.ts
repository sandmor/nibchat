export const UNNAMED_CHAT_TITLE = "New conversation"
export const TITLE_MAX_CHARS = 72

/** Sidebar / header label for a possibly unnamed chat. */
export function displayChatTitle(title: string | null | undefined) {
  const trimmed = title?.trim()
  return trimmed || UNNAMED_CHAT_TITLE
}

/** First-message heuristic used when the title LLM is off or fails. */
export function seedChatTitle(message: string, attachmentNames: string[]) {
  const seed =
    message.trim() ||
    attachmentNames.filter(Boolean).join(", ") ||
    UNNAMED_CHAT_TITLE
  return seed.slice(0, TITLE_MAX_CHARS)
}

/** First non-edit `continue` only: skip if already named, else seed or generate. */
export function firstTurnTitleAction(
  title: string | null,
  titleModelConfigured: boolean,
  editedFromNodeId?: string
): "skip" | "seed" | "generate" {
  if (title != null || editedFromNodeId) return "skip"
  return titleModelConfigured ? "generate" : "seed"
}
