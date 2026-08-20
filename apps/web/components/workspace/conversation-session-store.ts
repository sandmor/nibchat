"use client"

import { create } from "zustand"
import type { AttachmentReference } from "@/lib/types"
import type { MessageEditSegment } from "@/lib/agent/parts"

export type ComposerSurface = "linear" | "tree"

export type ComposerAttachment = {
  name: string
  reference: AttachmentReference
  previewUrl?: string
  uploading?: boolean
  /** Server already claimed this upload onto a message; do not DELETE it. */
  claimed?: boolean
}

export type ComposerDraft = {
  text: string
  attachments: ComposerAttachment[]
}

export type MessageEditDraft = MessageEditSegment[]

const emptyDraft = (): ComposerDraft => ({ text: "", attachments: [] })

/**
 * Read-only fallback when a slot has not been created. Selectors must return
 * this same reference so missing slots do not look like updates.
 */
export const EMPTY_COMPOSER_DRAFT: ComposerDraft = emptyDraft()
const EMPTY_MESSAGE_EDIT: MessageEditDraft = []

/**
 * Stable session identity for a composer. The graph stays in React Query; this
 * store contains only unsent, view-local material such as text and uploads.
 * Linear and Tree use different slots: one Linear draft, and any number of
 * Tree drafts keyed by the parent the plus node sits under.
 *
 * Identity vs payload matches live streams: orchestrators subscribe to which
 * slots exist (`useTreeDraftSlotSignature`); SessionComposer reads one slot.
 */
export function composerSlotId(
  chatId: string | null,
  surface: ComposerSurface,
  parentNodeId: string | null
) {
  return `${chatId ?? "draft"}:${surface}:${parentNodeId ?? "root"}`
}

export function messageEditSlotId(chatId: string, nodeId: string) {
  return `${chatId}:edit:${nodeId}`
}

type ConversationSessionState = {
  drafts: Record<string, ComposerDraft>
  edits: Record<string, MessageEditDraft>
  update: (slot: string, update: Partial<ComposerDraft>) => void
  setEdit: (slot: string, edits: MessageEditDraft) => void
  updateEditSegment: (slot: string, index: number, text: string) => void
  clear: (slot: string) => void
  clearChat: (chatId: string | null) => void
}

/**
 * Prefer `useComposerDraft(slot)` or `useTreeDraftSlotSignature(chatId)`.
 * Selecting `state.drafts` re-renders the subscriber on every keystroke.
 */
export const useConversationSessionStore = create<ConversationSessionState>(
  (set) => ({
    drafts: {},
    edits: {},
    update: (slot, update) =>
      set((state) => ({
        drafts: {
          ...state.drafts,
          [slot]: { ...(state.drafts[slot] ?? emptyDraft()), ...update },
        },
      })),
    setEdit: (slot, edits) =>
      set((state) => ({
        edits: { ...state.edits, [slot]: edits },
      })),
    updateEditSegment: (slot, index, text) =>
      set((state) => {
        const current = state.edits[slot]
        if (!current) return state
        return {
          edits: {
            ...state.edits,
            [slot]: current.map((segment, i) =>
              i === index ? { ...segment, text } : segment
            ),
          },
        }
      }),
    clear: (slot) =>
      set((state) => {
        const drafts = { ...state.drafts }
        const edits = { ...state.edits }
        delete drafts[slot]
        delete edits[slot]
        return { drafts, edits }
      }),
    clearChat: (chatId) => {
      const prefix = `${chatId ?? "draft"}:`
      return set((state) => ({
        drafts: Object.fromEntries(
          Object.entries(state.drafts).filter(
            ([slot]) => !slot.startsWith(prefix)
          )
        ),
        edits: Object.fromEntries(
          Object.entries(state.edits).filter(
            ([slot]) => !slot.startsWith(prefix)
          )
        ),
      }))
    },
  })
)

export function readComposerDraft(slot: string): ComposerDraft {
  return (
    useConversationSessionStore.getState().drafts[slot] ?? EMPTY_COMPOSER_DRAFT
  )
}

export function hasComposerDraft(slot: string) {
  return Object.hasOwn(useConversationSessionStore.getState().drafts, slot)
}

/** One slot's draft. Typing re-renders only this subscriber, not the chat view. */
export function useComposerDraft(slot: string): ComposerDraft {
  return useConversationSessionStore(
    (state) => state.drafts[slot] ?? EMPTY_COMPOSER_DRAFT
  )
}

/**
 * Identity of open Tree composers for a chat. Stable across text and
 * attachment edits so the canvas can ignore keystrokes.
 */
export function treeDraftSlotSignature(
  drafts: Record<string, ComposerDraft>,
  chatId: string | null | undefined
): string {
  if (!chatId) return ""
  const prefix = `${chatId}:tree:`
  return Object.keys(drafts)
    .filter((slot) => slot.startsWith(prefix))
    .sort()
    .join("\0")
}

export function useTreeDraftSlotSignature(chatId: string | null | undefined) {
  return useConversationSessionStore((state) =>
    treeDraftSlotSignature(state.drafts, chatId)
  )
}

export function treeDraftAnchorsForChat(
  drafts: Record<string, ComposerDraft>,
  chatId: string
): Set<string | null> {
  const prefix = `${chatId}:tree:`
  const anchors = new Set<string | null>()
  for (const slot of Object.keys(drafts)) {
    if (!slot.startsWith(prefix)) continue
    const rest = slot.slice(prefix.length)
    anchors.add(rest === "root" ? null : rest)
  }
  return anchors
}

export function hasMessageEdit(slot: string) {
  return Object.hasOwn(useConversationSessionStore.getState().edits, slot)
}

/** One message's in-progress edit. Typing re-renders only this subscriber. */
export function useMessageEdit(slot: string): MessageEditDraft {
  return useConversationSessionStore(
    (state) => state.edits[slot] ?? EMPTY_MESSAGE_EDIT
  )
}

export function useHasMessageEdit(slot: string) {
  return useConversationSessionStore((state) =>
    Object.hasOwn(state.edits, slot)
  )
}

/**
 * Identity of in-progress message edits for a chat. Stable across keystrokes
 * so the tree canvas can keep those cards live without re-rendering on type.
 */
export function messageEditSlotSignature(
  edits: Record<string, MessageEditDraft>,
  chatId: string | null | undefined
): string {
  if (!chatId) return ""
  const prefix = `${chatId}:edit:`
  return Object.keys(edits)
    .filter((slot) => slot.startsWith(prefix))
    .sort()
    .join("\0")
}

export function useMessageEditSlotSignature(chatId: string | null | undefined) {
  return useConversationSessionStore((state) =>
    messageEditSlotSignature(state.edits, chatId)
  )
}

export function messageEditNodeIdsForChat(
  edits: Record<string, MessageEditDraft>,
  chatId: string
): Set<string> {
  const prefix = `${chatId}:edit:`
  const ids = new Set<string>()
  for (const slot of Object.keys(edits)) {
    if (!slot.startsWith(prefix)) continue
    ids.add(slot.slice(prefix.length))
  }
  return ids
}

/** Abandoned drafts delete uploads; in-flight tree sends must not. */
export function shouldDeleteUploadedAttachment(attachment: ComposerAttachment) {
  return (
    attachment.reference.kind === "uploaded-file" &&
    !attachment.uploading &&
    !attachment.claimed
  )
}
