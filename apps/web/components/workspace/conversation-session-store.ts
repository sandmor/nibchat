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

export type UserTurnSession = {
  kind: "user-turn"
  text: string
  attachments: ComposerAttachment[]
}

export type PartsSession = {
  kind: "parts"
  segments: MessageEditSegment[]
}

export type MessageEditorSession = UserTurnSession | PartsSession

function emptyUserTurn(): UserTurnSession {
  return { kind: "user-turn", text: "", attachments: [] }
}

/**
 * Read-only fallback when a slot has not been created. Selectors must return
 * this same reference so missing slots do not look like updates.
 */
export const EMPTY_COMPOSER_DRAFT: ComposerDraft = {
  text: "",
  attachments: [],
}
const EMPTY_MESSAGE_EDIT: MessageEditDraft = []

/**
 * Stable session identity for a composer. The graph stays in React Query; this
 * store contains only unsent, view-local material such as text and uploads.
 * Linear and Tree use different slots: one Linear draft, and any number of
 * Tree drafts keyed by the parent the plus node sits under.
 *
 * Identity vs payload matches live streams: orchestrators subscribe to which
 * slots exist (`useTreeDraftSlotSignature`); SessionMessageEditor reads one slot.
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
  sessions: Record<string, MessageEditorSession>
  sending: Record<string, true>
  update: (slot: string, update: Partial<ComposerDraft>) => void
  setParts: (slot: string, segments: MessageEditDraft) => void
  updatePartsSegment: (slot: string, index: number, text: string) => void
  setSending: (slot: string, sending: boolean) => void
  clear: (slot: string) => void
  clearChat: (chatId: string | null) => void
}

/**
 * Prefer `useComposerDraft(slot)` or `useTreeDraftSlotSignature(chatId)`.
 * Selecting `state.sessions` re-renders the subscriber on every keystroke.
 */
export const useConversationSessionStore = create<ConversationSessionState>(
  (set) => ({
    sessions: {},
    sending: {},
    update: (slot, update) =>
      set((state) => {
        const current = state.sessions[slot]
        if (current && current.kind !== "user-turn") return state
        const base = current ?? emptyUserTurn()
        return {
          sessions: {
            ...state.sessions,
            [slot]: {
              kind: "user-turn",
              text: update.text ?? base.text,
              attachments: update.attachments ?? base.attachments,
            },
          },
        }
      }),
    setParts: (slot, segments) =>
      set((state) => ({
        sessions: {
          ...state.sessions,
          [slot]: { kind: "parts", segments },
        },
      })),
    updatePartsSegment: (slot, index, text) =>
      set((state) => {
        const current = state.sessions[slot]
        if (current?.kind !== "parts") return state
        return {
          sessions: {
            ...state.sessions,
            [slot]: {
              kind: "parts",
              segments: current.segments.map((segment, i) =>
                i === index ? { ...segment, text } : segment
              ),
            },
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
        const sessions = { ...state.sessions }
        const sending = { ...state.sending }
        delete sessions[slot]
        delete sending[slot]
        return { sessions, sending }
      }),
    clearChat: (chatId) => {
      const prefix = `${chatId ?? "draft"}:`
      return set((state) => ({
        sessions: Object.fromEntries(
          Object.entries(state.sessions).filter(
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

function readSession(slot: string): MessageEditorSession | undefined {
  return useConversationSessionStore.getState().sessions[slot]
}

/** User-turn payload for compose / user-edit send paths. */
export function readComposerDraft(slot: string): ComposerDraft {
  const session = readSession(slot)
  if (session?.kind !== "user-turn") return EMPTY_COMPOSER_DRAFT
  return session
}

export function hasComposerDraft(slot: string) {
  return readSession(slot)?.kind === "user-turn"
}

export function hasEditorSession(slot: string) {
  return Object.hasOwn(useConversationSessionStore.getState().sessions, slot)
}

export function isEditorSending(slot: string) {
  return Object.hasOwn(useConversationSessionStore.getState().sending, slot)
}

/** In-flight send for one slot. Independent of draft text so typing stays cheap. */
export function useEditorSending(slot: string) {
  return useConversationSessionStore((state) =>
    Object.hasOwn(state.sending, slot)
  )
}

export function useHasEditorSession(slot: string) {
  return useConversationSessionStore((state) =>
    Object.hasOwn(state.sessions, slot)
  )
}

/** One slot's user-turn draft. Typing re-renders only this subscriber. */
export function useComposerDraft(slot: string): ComposerDraft {
  return useConversationSessionStore((state) => {
    const session = state.sessions[slot]
    if (session?.kind !== "user-turn") return EMPTY_COMPOSER_DRAFT
    return session
  })
}

export function useEditorSession(slot: string): MessageEditorSession | null {
  return useConversationSessionStore((state) => state.sessions[slot] ?? null)
}

/**
 * Identity of open Tree composers for a chat. Stable across text and
 * attachment edits so the canvas can ignore keystrokes.
 */
export function treeDraftSlotSignature(
  sessions: Record<string, MessageEditorSession>,
  chatId: string | null | undefined
): string {
  if (!chatId) return ""
  const prefix = `${chatId}:tree:`
  return Object.keys(sessions)
    .filter((slot) => slot.startsWith(prefix))
    .sort()
    .join("\0")
}

export function useTreeDraftSlotSignature(chatId: string | null | undefined) {
  return useConversationSessionStore((state) =>
    treeDraftSlotSignature(state.sessions, chatId)
  )
}

export function treeDraftAnchorsForChat(
  sessions: Record<string, MessageEditorSession>,
  chatId: string
): Set<string | null> {
  const prefix = `${chatId}:tree:`
  const anchors = new Set<string | null>()
  for (const slot of Object.keys(sessions)) {
    if (!slot.startsWith(prefix)) continue
    const rest = slot.slice(prefix.length)
    anchors.add(rest === "root" ? null : rest)
  }
  return anchors
}

export function hasMessageEdit(slot: string) {
  return readSession(slot)?.kind === "parts"
}

/** One message's in-progress part edit. Typing re-renders only this subscriber. */
export function useMessageEdit(slot: string): MessageEditDraft {
  return useConversationSessionStore((state) => {
    const session = state.sessions[slot]
    return session?.kind === "parts" ? session.segments : EMPTY_MESSAGE_EDIT
  })
}

/**
 * Identity of in-progress message edits for a chat. Stable across keystrokes
 * so the tree canvas can keep those cards live without re-rendering on type.
 */
export function messageEditSlotSignature(
  sessions: Record<string, MessageEditorSession>,
  chatId: string | null | undefined
): string {
  if (!chatId) return ""
  const prefix = messageEditSlotPrefix(chatId)
  return Object.keys(sessions)
    .filter((slot) => slot.startsWith(prefix))
    .sort()
    .join("\0")
}

export function useMessageEditSlotSignature(chatId: string | null | undefined) {
  return useConversationSessionStore((state) =>
    messageEditSlotSignature(state.sessions, chatId)
  )
}

export function messageEditNodeIdsForChat(
  sessions: Record<string, MessageEditorSession>,
  chatId: string
): Set<string> {
  const prefix = messageEditSlotPrefix(chatId)
  const ids = new Set<string>()
  for (const slot of Object.keys(sessions)) {
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
