import type { ChatViewState } from "@/lib/chat-view-state"

export type PendingChatViewState = { chatId: string; state: ChatViewState }

/**
 * Drain each conversation at most once per pass. A failed state stays queued
 * for the next explicit retry, while unrelated conversations can still save.
 */
export async function drainChatViewStateSaves(
  pendingStates: Map<string, ChatViewState>,
  persist: (pending: PendingChatViewState) => Promise<unknown>,
  options: { onSaved: () => void; onFailed: () => void }
) {
  let failed = false
  const failedChatIds = new Set<string>()

  while (true) {
    const pending = [...pendingStates.entries()].find(
      ([chatId]) => !failedChatIds.has(chatId)
    )
    if (!pending) break

    const [chatId, state] = pending
    pendingStates.delete(chatId)
    try {
      await persist({ chatId, state })
      options.onSaved()
    } catch {
      failed = true
      failedChatIds.add(chatId)
      options.onFailed()
      // Preserve a newer update that was queued during the failed request.
      if (!pendingStates.has(chatId)) pendingStates.set(chatId, state)
    }
  }

  return { failed }
}
