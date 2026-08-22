import { describe, expect, it } from "vitest"
import type { ChatViewState } from "@/lib/chat-view-state"
import {
  drainChatViewStateSaves,
  type PendingChatViewState,
} from "./chat-view-state-persistence"

const linear: ChatViewState = { mode: "linear", camera: null }
const tree: ChatViewState = { mode: "tree", camera: null }

describe("drainChatViewStateSaves", () => {
  it("retains a failed chat while continuing with other conversations", async () => {
    const pending = new Map<string, ChatViewState>([
      ["a", tree],
      ["b", linear],
    ])
    const saved: PendingChatViewState[] = []

    const result = await drainChatViewStateSaves(
      pending,
      async (entry) => {
        saved.push(entry)
        if (entry.chatId === "a") throw new Error("offline")
      },
      { onSaved: () => {}, onFailed: () => {} }
    )

    expect(result.failed).toBe(true)
    expect(saved.map(({ chatId }) => chatId)).toEqual(["a", "b"])
    expect(pending).toEqual(new Map([["a", tree]]))
  })

  it("keeps a newer state queued when an older request fails", async () => {
    const pending = new Map<string, ChatViewState>([["a", linear]])
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      release = resolve
    })

    const drain = drainChatViewStateSaves(
      pending,
      async () => {
        await started
        throw new Error("offline")
      },
      { onSaved: () => {}, onFailed: () => {} }
    )
    pending.set("a", tree)
    release()
    await drain

    expect(pending).toEqual(new Map([["a", tree]]))
  })
})
