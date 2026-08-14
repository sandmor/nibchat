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
 * Stable session identity for a composer. The graph stays in React Query; this
 * store contains only unsent, view-local material such as text and uploads.
 * Linear and Tree use different slots: one Linear draft, and any number of
 * Tree drafts keyed by the parent the plus node sits under.
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

export const emptyComposerDraft = emptyDraft

/** Abandoned drafts delete uploads; in-flight tree sends must not. */
export function shouldDeleteUploadedAttachment(attachment: ComposerAttachment) {
  return (
    attachment.reference.kind === "uploaded-file" &&
    !attachment.uploading &&
    !attachment.claimed
  )
}
