import { beforeEach, describe, expect, it } from "vitest"
import {
  composerSlotId,
  hasComposerDraft,
  hasMessageEdit,
  messageEditNodeIdsForChat,
  messageEditSlotId,
  messageEditSlotSignature,
  readComposerDraft,
  shouldDeleteUploadedAttachment,
  treeDraftAnchorsForChat,
  treeDraftSlotSignature,
  useConversationSessionStore,
  EMPTY_COMPOSER_DRAFT,
} from "./conversation-session-store"

describe("shouldDeleteUploadedAttachment", () => {
  it("deletes abandoned uploads and keeps files already claimed onto a message", () => {
    const file = {
      name: "shot.png",
      reference: { kind: "uploaded-file" as const, id: "att-1" },
    }
    expect(shouldDeleteUploadedAttachment(file)).toBe(true)
    expect(shouldDeleteUploadedAttachment({ ...file, claimed: true })).toBe(
      false
    )
  })
})

describe("composer session selectors", () => {
  beforeEach(() => {
    useConversationSessionStore.setState({ drafts: {}, edits: {} })
  })

  it("returns the shared empty draft until a slot is written", () => {
    const slot = composerSlotId("chat-1", "linear", null)
    expect(readComposerDraft(slot)).toBe(EMPTY_COMPOSER_DRAFT)
    expect(hasComposerDraft(slot)).toBe(false)
  })

  it("keeps the tree slot signature stable when only draft text changes", () => {
    const { update } = useConversationSessionStore.getState()
    const slot = composerSlotId("chat-1", "tree", "node-1")
    update(slot, { text: "a" })
    const before = treeDraftSlotSignature(
      useConversationSessionStore.getState().drafts,
      "chat-1"
    )
    const draftsBefore = useConversationSessionStore.getState().drafts
    update(slot, { text: "ab" })
    const after = treeDraftSlotSignature(
      useConversationSessionStore.getState().drafts,
      "chat-1"
    )
    const draftsAfter = useConversationSessionStore.getState().drafts
    expect(after).toBe(before)
    expect(draftsAfter).not.toBe(draftsBefore)
  })

  it("keeps the tree slot signature stable when attachments change", () => {
    const { update } = useConversationSessionStore.getState()
    const slot = composerSlotId("chat-1", "tree", "node-1")
    update(slot, { text: "hi" })
    const before = treeDraftSlotSignature(
      useConversationSessionStore.getState().drafts,
      "chat-1"
    )
    update(slot, {
      attachments: [
        {
          name: "shot.png",
          reference: { kind: "uploaded-file", id: "att-1" },
        },
      ],
    })
    expect(
      treeDraftSlotSignature(
        useConversationSessionStore.getState().drafts,
        "chat-1"
      )
    ).toBe(before)
  })

  it("changes the tree slot signature when a tree draft is opened or closed", () => {
    const { update, clear } = useConversationSessionStore.getState()
    const slot = composerSlotId("chat-1", "tree", "node-1")
    expect(
      treeDraftSlotSignature(
        useConversationSessionStore.getState().drafts,
        "chat-1"
      )
    ).toBe("")
    update(slot, { text: "" })
    const open = treeDraftSlotSignature(
      useConversationSessionStore.getState().drafts,
      "chat-1"
    )
    expect(open).toBe(slot)
    clear(slot)
    expect(
      treeDraftSlotSignature(
        useConversationSessionStore.getState().drafts,
        "chat-1"
      )
    ).toBe("")
  })

  it("ignores linear drafts and other chats when listing tree anchors", () => {
    const { update } = useConversationSessionStore.getState()
    update(composerSlotId("chat-1", "linear", null), { text: "dock" })
    update(composerSlotId("chat-1", "tree", null), { text: "root" })
    update(composerSlotId("chat-1", "tree", "node-1"), { text: "branch" })
    update(composerSlotId("chat-2", "tree", "node-9"), { text: "other" })
    expect(
      treeDraftAnchorsForChat(
        useConversationSessionStore.getState().drafts,
        "chat-1"
      )
    ).toEqual(new Set([null, "node-1"]))
  })
})

describe("message edit session selectors", () => {
  beforeEach(() => {
    useConversationSessionStore.setState({ drafts: {}, edits: {} })
  })

  it("keeps the edit slot signature stable when only segment text changes", () => {
    const { setEdit, updateEditSegment } =
      useConversationSessionStore.getState()
    const slot = messageEditSlotId("chat-1", "node-1")
    setEdit(slot, [{ type: "text", text: "a" }])
    const before = messageEditSlotSignature(
      useConversationSessionStore.getState().edits,
      "chat-1"
    )
    updateEditSegment(slot, 0, "ab")
    const after = messageEditSlotSignature(
      useConversationSessionStore.getState().edits,
      "chat-1"
    )
    expect(after).toBe(before)
    expect(after).toBe(slot)
  })

  it("changes the edit slot signature when an edit is opened or closed", () => {
    const { setEdit, clear } = useConversationSessionStore.getState()
    const slot = messageEditSlotId("chat-1", "node-1")
    expect(
      messageEditSlotSignature(
        useConversationSessionStore.getState().edits,
        "chat-1"
      )
    ).toBe("")
    setEdit(slot, [{ type: "text", text: "hi" }])
    expect(hasMessageEdit(slot)).toBe(true)
    expect(
      messageEditNodeIdsForChat(
        useConversationSessionStore.getState().edits,
        "chat-1"
      )
    ).toEqual(new Set(["node-1"]))
    clear(slot)
    expect(hasMessageEdit(slot)).toBe(false)
    expect(
      messageEditSlotSignature(
        useConversationSessionStore.getState().edits,
        "chat-1"
      )
    ).toBe("")
  })

  it("clears message edits with the chat", () => {
    const { setEdit, update, clearChat } =
      useConversationSessionStore.getState()
    const keep = messageEditSlotId("chat-2", "node-9")
    setEdit(messageEditSlotId("chat-1", "node-1"), [
      { type: "text", text: "gone" },
    ])
    setEdit(keep, [{ type: "text", text: "stay" }])
    update(composerSlotId("chat-1", "linear", null), { text: "dock" })
    clearChat("chat-1")
    expect(hasMessageEdit(keep)).toBe(true)
    expect(hasMessageEdit(messageEditSlotId("chat-1", "node-1"))).toBe(false)
    expect(hasComposerDraft(composerSlotId("chat-1", "linear", null))).toBe(
      false
    )
  })
})
