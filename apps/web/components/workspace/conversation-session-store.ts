"use client"

import { create } from "zustand"
import type { AttachmentReference, Part, Parts, TextPart } from "@/lib/types"
import {
  coalesceAdjacentTextParts,
  convertPartsToRole,
  type ConversationAuthorRole,
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

export type MessageEditorSession = {
  role: ConversationAuthorRole
  parts: Parts
  keys: string[]
  attachments: ComposerAttachment[]
}

/** Remove the material accepted by a send while preserving edits made after it. */
export function clearSubmittedComposerDraft(
  current: ComposerDraft,
  submittedText: string,
  submittedAttachments: ComposerAttachment[]
): ComposerDraft {
  const submittedReferences = new Set(
    submittedAttachments.map((attachment) =>
      JSON.stringify(attachment.reference)
    )
  )
  return {
    text: current.text === submittedText ? "" : current.text,
    attachments: current.attachments.filter(
      (attachment) =>
        !submittedReferences.has(JSON.stringify(attachment.reference))
    ),
  }
}

function emptySession(
  role: ConversationAuthorRole = "user"
): MessageEditorSession {
  return {
    role,
    parts: [{ type: "text", text: "" }],
    keys: [newBlockKey()],
    attachments: [],
  }
}

export function newBlockKey() {
  return crypto.randomUUID()
}

export function keysForParts(parts: Parts, previous?: string[]): string[] {
  if (previous && previous.length === parts.length) return previous
  return parts.map((_, index) => previous?.[index] ?? newBlockKey())
}

export function composerTextFromParts(parts: Parts): string {
  return parts
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
}

function applyComposerText(parts: Parts, text: string): Parts {
  const first = parts.findIndex((part) => part.type === "text")
  const next: TextPart = { type: "text", text }
  if (first === -1) return [next, ...parts]
  const result: Parts = []
  let inserted = false
  for (const part of parts) {
    if (part.type === "text") {
      if (!inserted) {
        result.push(next)
        inserted = true
      }
      continue
    }
    result.push(part)
  }
  return result
}

function composerDraftFromSession(
  session: MessageEditorSession
): ComposerDraft {
  return {
    text: composerTextFromParts(session.parts),
    attachments: session.attachments,
  }
}

/**
 * Read-only fallback when a slot has not been created. Selectors must return
 * this same reference so missing slots do not look like updates.
 */
export const EMPTY_COMPOSER_DRAFT: ComposerDraft = {
  text: "",
  attachments: [],
}

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
  const text = composerTextFromParts(coalesced)
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

export function sessionFromMessage(input: {
  role: ConversationAuthorRole
  parts: Parts
}): MessageEditorSession {
  const coalesced = coalesceAdjacentTextParts(input.parts)
  const parts =
    coalesced.length > 0 ? coalesced : ([{ type: "text", text: "" }] as Parts)
  return {
    role: input.role,
    parts,
    keys: keysForParts(parts),
    attachments:
      input.role === "user" ? composerDraftFromUserParts(parts).attachments : [],
  }
}

export function revokeComposerPreviewUrl(url: string | undefined) {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url)
}

type ConversationSessionState = {
  sessions: Record<string, MessageEditorSession>
  sending: Record<string, true>
  update: (slot: string, update: Partial<ComposerDraft>) => void
  setSession: (slot: string, session: MessageEditorSession) => void
  setParts: (slot: string, parts: Parts) => void
  replacePart: (slot: string, index: number, part: Part) => void
  insertPart: (slot: string, index: number, part: Part) => void
  removePart: (slot: string, index: number) => void
  movePart: (slot: string, from: number, to: number) => void
  convertRole: (slot: string, role: ConversationAuthorRole) => void
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
        const current = state.sessions[slot] ?? emptySession("user")
        const parts =
          update.text === undefined
            ? current.parts
            : applyComposerText(current.parts, update.text)
        const attachments = update.attachments ?? current.attachments
        return {
          sessions: {
            ...state.sessions,
            [slot]: {
              ...current,
              parts,
              keys: keysForParts(parts, current.keys),
              attachments,
            },
          },
        }
      }),
    setSession: (slot, session) =>
      set((state) => ({
        sessions: {
          ...state.sessions,
          [slot]: {
            ...session,
            keys: keysForParts(session.parts, session.keys),
          },
        },
      })),
    setParts: (slot, parts) =>
      set((state) => {
        const current = state.sessions[slot] ?? emptySession("assistant")
        return {
          sessions: {
            ...state.sessions,
            [slot]: {
              ...current,
              parts,
              keys: keysForParts(parts),
            },
          },
        }
      }),
    replacePart: (slot, index, part) =>
      set((state) => {
        const current = state.sessions[slot]
        if (!current || index < 0 || index >= current.parts.length) return state
        const parts = current.parts.slice()
        parts[index] = part
        return {
          sessions: {
            ...state.sessions,
            [slot]: { ...current, parts },
          },
        }
      }),
    insertPart: (slot, index, part) =>
      set((state) => {
        const current = state.sessions[slot]
        if (!current) return state
        const at = Math.max(0, Math.min(index, current.parts.length))
        const parts = current.parts.slice()
        const keys = current.keys.slice()
        parts.splice(at, 0, part)
        keys.splice(at, 0, newBlockKey())
        return {
          sessions: {
            ...state.sessions,
            [slot]: { ...current, parts, keys: keysForParts(parts, keys) },
          },
        }
      }),
    removePart: (slot, index) =>
      set((state) => {
        const current = state.sessions[slot]
        if (!current || index < 0 || index >= current.parts.length) return state
        const removed = current.parts[index]
        const parts = current.parts.slice()
        const keys = current.keys.slice()
        parts.splice(index, 1)
        keys.splice(index, 1)
        const nextParts =
          parts.length > 0 ? parts : ([{ type: "text", text: "" }] as Parts)
        const attachments =
          removed?.type === "attachment"
            ? current.attachments.filter(
                (item) => !attachmentMatchesPart(item, removed)
              )
            : current.attachments
        return {
          sessions: {
            ...state.sessions,
            [slot]: {
              ...current,
              parts: nextParts,
              keys: keysForParts(nextParts, keys),
              attachments,
            },
          },
        }
      }),
    movePart: (slot, from, to) =>
      set((state) => {
        const current = state.sessions[slot]
        if (!current) return state
        if (from === to) return state
        if (from < 0 || from >= current.parts.length) return state
        const target = Math.max(0, Math.min(to, current.parts.length - 1))
        const parts = current.parts.slice()
        const keys = current.keys.slice()
        const [part] = parts.splice(from, 1)
        const [key] = keys.splice(from, 1)
        if (!part || !key) return state
        parts.splice(target, 0, part)
        keys.splice(target, 0, key)
        return {
          sessions: {
            ...state.sessions,
            [slot]: { ...current, parts, keys },
          },
        }
      }),
    convertRole: (slot, role) =>
      set((state) => {
        const current = state.sessions[slot]
        if (!current || current.role === role) return state
        const parts = convertPartsToRole(current.parts, role)
        return {
          sessions: {
            ...state.sessions,
            [slot]: {
              role,
              parts,
              keys: keysForParts(parts),
              attachments: [],
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
  if (!session) return EMPTY_COMPOSER_DRAFT
  return composerDraftFromSession(session)
}

export function hasComposerDraft(slot: string) {
  return Object.hasOwn(useConversationSessionStore.getState().sessions, slot)
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
  const session = useConversationSessionStore((state) => state.sessions[slot])
  if (!session) return EMPTY_COMPOSER_DRAFT
  return composerDraftFromSession(session)
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
  return hasEditorSession(slot)
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

export function attachmentMatchesPart(
  attachment: ComposerAttachment,
  part: Extract<Part, { type: "attachment" }>
) {
  if (attachment.reference.kind === "uploaded-file") {
    return (
      (part.content.kind === "binary" || part.content.kind === "document") &&
      part.content.attachmentId === attachment.reference.id
    )
  }
  return (
    part.source.kind === "mcp-resource" &&
    attachment.reference.profileId === part.source.profileId &&
    attachment.reference.uri === part.source.uri
  )
}

/** Durable document plus sidecar files that are not already blocks. */
export function authoredPartsFromSession(session: MessageEditorSession): {
  parts: Parts
  attachments: AttachmentReference[]
} {
  const attachments = session.attachments.flatMap((item) => {
    if (item.uploading) return []
    if (
      session.parts.some(
        (part) => part.type === "attachment" && attachmentMatchesPart(item, part)
      )
    )
      return []
    return [item.reference]
  })
  return { parts: session.parts, attachments }
}
