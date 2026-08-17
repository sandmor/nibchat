"use client"

import { create } from "zustand"
import type { AttachmentReference } from "@/lib/types"

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

const emptyDraft = (): ComposerDraft => ({ text: "", attachments: [] })

/**
 * Read-only fallback when a slot has not been created. Selectors must return
 * this same reference so missing slots do not look like updates.
 */
export const EMPTY_COMPOSER_DRAFT: ComposerDraft = emptyDraft()

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

type ConversationSessionState = {
  drafts: Record<string, ComposerDraft>
  update: (slot: string, update: Partial<ComposerDraft>) => void
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
    update: (slot, update) =>
      set((state) => ({
        drafts: {
          ...state.drafts,
          [slot]: { ...(state.drafts[slot] ?? emptyDraft()), ...update },
        },
      })),
    clear: (slot) =>
      set((state) => {
        const drafts = { ...state.drafts }
        delete drafts[slot]
        return { drafts }
      }),
    clearChat: (chatId) =>
      set((state) => ({
        drafts: Object.fromEntries(
          Object.entries(state.drafts).filter(
            ([slot]) => !slot.startsWith(`${chatId ?? "draft"}:`)
          )
        ),
      })),
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

/** Abandoned drafts delete uploads; in-flight tree sends must not. */
export function shouldDeleteUploadedAttachment(attachment: ComposerAttachment) {
  return (
    attachment.reference.kind === "uploaded-file" &&
    !attachment.uploading &&
    !attachment.claimed
  )
}
