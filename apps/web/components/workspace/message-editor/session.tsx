"use client"

import { memo, useCallback, useMemo, useRef } from "react"
import {
  useComposerDraft,
  useEditorSending,
  useConversationSessionStore,
  useEditorSession,
  type ComposerAttachment,
} from "../conversation-session-store"
import type { EditorPlacement, EditorPurpose } from "./layout"
import { PartsEditor } from "./parts-body"
import { UserTurnEditor } from "./user-body"

export type SessionMessageEditorProps = {
  slot: string
  placeholder: string
  autoFocus?: boolean
  variant?: "docked" | "inline"
  purpose?: EditorPurpose
  placement?: EditorPlacement
  mcpAvailable?: boolean
  /** Assistant-authored messages cannot contain attachments. */
  allowAttachments?: boolean
  streaming?: boolean
  submitting?: boolean
  animate?: boolean
  showContextPreview?: boolean
  contextParentId?: string | null
  sendLabel?: string
  onSend: () => void
  onCancel?: () => void
  onFiles?: (files: File[] | FileList) => void
  onRemoveAttachment?: (part: ComposerAttachment) => void
  onPreview?: (src: string, name: string) => void
  onOpenResources?: () => void
  onOpenPrompts?: () => void
  onStop?: () => void
  onRevealContextMessage?: (nodeId: string) => void
  onReplace?: () => void
  onConvertRole?: (role: "user" | "assistant") => void
  /** Compose-only. Empty Send starts a generation without inserting a user turn. */
  allowEmptySend?: boolean
  overlayNodeId?: string
}

/**
 * Session-bound editor. The wrapper always runs with the parent so action
 * refs stay current; the leaf subscribes to one slot and ignores parent
 * re-renders that only change callback identity (stream tokens, queries).
 */
export function SessionMessageEditor(props: SessionMessageEditorProps) {
  const latestRef = useRef(props)
  latestRef.current = props
  return (
    <SessionMessageEditorLeaf
      slot={props.slot}
      placeholder={props.placeholder}
      autoFocus={props.autoFocus}
      variant={props.variant}
      purpose={props.purpose}
      placement={props.placement}
      mcpAvailable={props.mcpAvailable}
      allowAttachments={props.allowAttachments}
      streaming={props.streaming}
      submitting={props.submitting}
      animate={props.animate}
      showContextPreview={props.showContextPreview}
      contextParentId={props.contextParentId}
      sendLabel={props.sendLabel}
      overlayNodeId={props.overlayNodeId}
      allowEmptySend={props.allowEmptySend}
      canReplace={Boolean(props.onReplace)}
      latestRef={latestRef}
    />
  )
}

const SessionMessageEditorLeaf = memo(function SessionMessageEditorLeaf({
  slot,
  placeholder,
  autoFocus,
  variant,
  purpose,
  placement,
  mcpAvailable,
  allowAttachments,
  streaming,
  submitting,
  animate,
  showContextPreview,
  contextParentId,
  sendLabel,
  overlayNodeId,
  allowEmptySend,
  canReplace,
  latestRef,
}: {
  slot: string
  placeholder?: string
  autoFocus?: boolean
  variant?: SessionMessageEditorProps["variant"]
  purpose?: EditorPurpose
  placement?: EditorPlacement
  mcpAvailable?: boolean
  allowAttachments?: boolean
  streaming?: boolean
  submitting?: boolean
  animate?: boolean
  showContextPreview?: boolean
  contextParentId?: string | null
  sendLabel?: string
  overlayNodeId?: string
  allowEmptySend?: boolean
  canReplace?: boolean
  latestRef: { current: SessionMessageEditorProps }
}) {
  const session = useEditorSession(slot)
  const draft = useComposerDraft(slot)
  const slotSending = useEditorSending(slot)
  const update = useConversationSessionStore((state) => state.update)
  const replacePart = useConversationSessionStore((state) => state.replacePart)
  const insertPart = useConversationSessionStore((state) => state.insertPart)
  const removePart = useConversationSessionStore((state) => state.removePart)
  const movePart = useConversationSessionStore((state) => state.movePart)
  const convertRole = useConversationSessionStore((state) => state.convertRole)
  const onTextChange = useCallback(
    (text: string) => update(slot, { text }),
    [slot, update]
  )
  const actions = useMemo(
    () => ({
      onSend: () => latestRef.current.onSend(),
      onCancel: () => latestRef.current.onCancel?.(),
      onReplace: () => latestRef.current.onReplace?.(),
      onFiles: (files: File[] | FileList) => latestRef.current.onFiles?.(files),
      onRemoveAttachment: (part: ComposerAttachment) =>
        latestRef.current.onRemoveAttachment?.(part),
      onPreview: (src: string, name: string) =>
        latestRef.current.onPreview?.(src, name),
      onOpenResources: () => latestRef.current.onOpenResources?.(),
      onOpenPrompts: () => latestRef.current.onOpenPrompts?.(),
      onStop: () => latestRef.current.onStop?.(),
      onRevealContextMessage: (nodeId: string) =>
        latestRef.current.onRevealContextMessage?.(nodeId),
      onConvertRole: (role: "user" | "assistant") => {
        const current =
          useConversationSessionStore.getState().sessions[slot]
        const dropped =
          role === "assistant" && current
            ? current.attachments.filter((item) => !item.claimed)
            : []
        convertRole(slot, role)
        for (const attachment of dropped) {
          latestRef.current.onRemoveAttachment?.(attachment)
        }
        latestRef.current.onConvertRole?.(role)
      },
    }),
    [latestRef, convertRole, slot]
  )
  const busy = Boolean(submitting) || slotSending
  const editSession = purpose === "edit" ? session : null

  if (editSession) {
    return (
      <PartsEditor
        key={slot}
        role={editSession.role}
        parts={editSession.parts}
        keys={editSession.keys}
        attachments={editSession.attachments}
        overlayNodeId={overlayNodeId ?? slot}
        variant={variant}
        placement={placement}
        submitting={busy}
        animate={animate}
        showContextPreview={showContextPreview}
        sendLabel={sendLabel}
        allowAttachments={
          allowAttachments !== false && editSession.role === "user"
        }
        onReplacePart={(index, part) => replacePart(slot, index, part)}
        onInsertPart={(index, part) => insertPart(slot, index, part)}
        onRemovePart={(index) => removePart(slot, index)}
        onMovePart={(from, to) => movePart(slot, from, to)}
        onConvertRole={actions.onConvertRole}
        onSend={actions.onSend}
        onCancel={actions.onCancel}
        onReplace={canReplace ? actions.onReplace : undefined}
        onRevealContextMessage={actions.onRevealContextMessage}
        onFiles={actions.onFiles}
        onRemoveAttachment={actions.onRemoveAttachment}
      />
    )
  }

  return (
    <UserTurnEditor
      key={slot}
      draft={draft}
      placeholder={placeholder ?? ""}
      autoFocus={autoFocus}
      variant={variant}
      purpose={purpose}
      placement={placement}
      mcpAvailable={Boolean(mcpAvailable)}
      allowAttachments={allowAttachments !== false}
      streaming={streaming}
      submitting={busy}
      animate={animate}
      showContextPreview={showContextPreview}
      contextParentId={contextParentId}
      sendLabel={sendLabel}
      allowEmptySend={allowEmptySend}
      onTextChange={onTextChange}
      onSend={actions.onSend}
      onCancel={actions.onCancel}
      onFiles={actions.onFiles}
      onRemoveAttachment={actions.onRemoveAttachment}
      onPreview={actions.onPreview}
      onOpenResources={actions.onOpenResources}
      onOpenPrompts={actions.onOpenPrompts}
      onStop={actions.onStop}
      onRevealContextMessage={actions.onRevealContextMessage}
    />
  )
})
