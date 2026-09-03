"use client"

import { create } from "zustand"
import type { AttachmentReference, Parts, TextPart } from "@/lib/types"
import {
  coalesceAdjacentTextParts,
  type MessageEditSegment,
} from "@/lib/agent/parts"
import type { PdfAnalysis } from "@/lib/pdf-analysis"

export type ComposerSurface = "linear" | "tree"

export type ComposerAttachment = {
  name: string
  reference: AttachmentReference
  previewUrl?: string
  /** Local extraction result used by the context preview before this upload is sent. */
  pdfAnalysis?: PdfAnalysis
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

export function messageEditSlotPrefix(chatId: string) {
  return `${chatId}:edit:`
}

/** Prefill an edit composer from a user message. Existing files stay claimed. */
export function composerDraftFromUserParts(parts: Parts): ComposerDraft {
  const coalesced = coalesceAdjacentTextParts(parts)
  const text = coalesced
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
  const attachments: ComposerAttachment[] = []
  for (const part of coalesced) {
    if (part.type !== "attachment") continue
    if (part.source.kind === "mcp-resource") {
      attachments.push({
        name: part.name,
        claimed: true,
        reference: {
          kind: "mcp-resource",
          profileId: part.source.profileId,
          uri: part.source.uri,
          resolution: { kind: "snapshot", id: part.id },
        },
      })
      continue
    }
    if (part.content.kind === "binary") {
      attachments.push({
        name: part.name,
        claimed: true,
        previewUrl: `/api/attachments/${part.content.attachmentId}`,
        reference: {
          kind: "uploaded-file",
          id: part.content.attachmentId,
        },
      })
      continue
    }
    if (part.content.kind === "document") {
      attachments.push({
        name: part.name,
        claimed: true,
        reference: {
          kind: "uploaded-file",
          id: part.content.attachmentId,
        },
        pdfAnalysis: { version: 1, ...part.content.analysis },
      })
    }
  }
  return { text, attachments }
}

export function revokeComposerPreviewUrl(url: string | undefined) {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url)
}

type ConversationSessionState = {
  drafts: Record<string, ComposerDraft>
  edits: Record<string, MessageEditDraft>
  sending: Record<string, true>
  update: (slot: string, update: Partial<ComposerDraft>) => void
  setEdit: (slot: string, edits: MessageEditDraft) => void
  updateEditSegment: (slot: string, index: number, text: string) => void
  setSending: (slot: string, sending: boolean) => void
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
    sending: {},
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
    setSending: (slot, sending) =>
      set((state) => {
        if (sending) {
          if (state.sending[slot]) return state
          return { sending: { ...state.sending, [slot]: true } }
        }
        if (!state.sending[slot]) return state
        const next = { ...state.sending }
        delete next[slot]
        return { sending: next }
      }),
    clear: (slot) =>
      set((state) => {
        const drafts = { ...state.drafts }
        const edits = { ...state.edits }
        const sending = { ...state.sending }
        delete drafts[slot]
        delete edits[slot]
        delete sending[slot]
        return { drafts, edits, sending }
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
        sending: Object.fromEntries(
          Object.entries(state.sending).filter(
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

export function isComposerSending(slot: string) {
  return Object.hasOwn(useConversationSessionStore.getState().sending, slot)
}

/** In-flight send for one slot. Independent of draft text so typing stays cheap. */
export function useComposerSending(slot: string) {
  return useConversationSessionStore((state) =>
    Object.hasOwn(state.sending, slot)
  )
}

export function useHasComposerDraft(slot: string) {
  return useConversationSessionStore((state) =>
    Object.hasOwn(state.drafts, slot)
  )
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
 * Includes assistant textarea slots (`edits`) and user-edit composers (`drafts`).
 */
export function messageEditSlotSignature(
  edits: Record<string, MessageEditDraft>,
  drafts: Record<string, ComposerDraft>,
  chatId: string | null | undefined
): string {
  if (!chatId) return ""
  const prefix = messageEditSlotPrefix(chatId)
  const keys = new Set<string>()
  for (const slot of Object.keys(edits)) {
    if (slot.startsWith(prefix)) keys.add(slot)
  }
  for (const slot of Object.keys(drafts)) {
    if (slot.startsWith(prefix)) keys.add(slot)
  }
  return [...keys].sort().join("\0")
}

export function useMessageEditSlotSignature(chatId: string | null | undefined) {
  return useConversationSessionStore((state) =>
    messageEditSlotSignature(state.edits, state.drafts, chatId)
  )
}

export function messageEditNodeIdsForChat(
  edits: Record<string, MessageEditDraft>,
  drafts: Record<string, ComposerDraft>,
  chatId: string
): Set<string> {
  const prefix = messageEditSlotPrefix(chatId)
  const ids = new Set<string>()
  for (const slot of Object.keys(edits)) {
    if (!slot.startsWith(prefix)) continue
    ids.add(slot.slice(prefix.length))
  }
  for (const slot of Object.keys(drafts)) {
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
