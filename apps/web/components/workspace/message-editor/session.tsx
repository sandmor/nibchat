"use client"

import { memo, useCallback, useMemo, useRef } from "react"
import type { Parts } from "@/lib/types"
import {
  useComposerDraft,
  useEditorSending,
  useConversationSessionStore,
  useEditorSession,
  useMessageEdit,
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
  sourceParts?: Parts
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
      streaming={props.streaming}
      submitting={props.submitting}
      animate={props.animate}
      showContextPreview={props.showContextPreview}
      contextParentId={props.contextParentId}
      sendLabel={props.sendLabel}
      sourceParts={props.sourceParts}
      overlayNodeId={props.overlayNodeId}
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
  streaming,
  submitting,
  animate,
  showContextPreview,
  contextParentId,
  sendLabel,
  sourceParts,
  overlayNodeId,
  latestRef,
}: {
  slot: string
  placeholder: string
  autoFocus?: boolean
  variant?: SessionMessageEditorProps["variant"]
  purpose?: EditorPurpose
  placement?: EditorPlacement
  mcpAvailable?: boolean
  streaming?: boolean
  submitting?: boolean
  animate?: boolean
  showContextPreview?: boolean
  contextParentId?: string | null
  sendLabel?: string
  sourceParts?: Parts
  overlayNodeId?: string
  latestRef: { current: SessionMessageEditorProps }
}) {
  const session = useEditorSession(slot)
  const draft = useComposerDraft(slot)
  const edits = useMessageEdit(slot)
  const slotSending = useEditorSending(slot)
  const update = useConversationSessionStore((state) => state.update)
  const updatePartsSegment = useConversationSessionStore(
    (state) => state.updatePartsSegment
  )
  const onTextChange = useCallback(
    (text: string) => update(slot, { text }),
    [slot, update]
  )
  const onSegmentChange = useCallback(
    (index: number, text: string) => updatePartsSegment(slot, index, text),
    [slot, updatePartsSegment]
  )
  const actions = useMemo(
    () => ({
      onSend: () => latestRef.current.onSend(),
      onCancel: () => latestRef.current.onCancel?.(),
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
    }),
    [latestRef]
  )
  const busy = Boolean(submitting) || slotSending

  if (session?.kind === "parts") {
    if (!sourceParts || !overlayNodeId) return null
    return (
      <PartsEditor
        key={slot}
        parts={sourceParts}
        edits={edits}
        overlayNodeId={overlayNodeId}
        variant={variant}
        placement={placement}
        submitting={busy}
        animate={animate}
        showContextPreview={showContextPreview}
        sendLabel={sendLabel}
        onEditChange={onSegmentChange}
        onSend={actions.onSend}
        onCancel={actions.onCancel}
        onRevealContextMessage={actions.onRevealContextMessage}
      />
    )
  }

  return (
    <UserTurnEditor
      key={slot}
      draft={draft}
      placeholder={placeholder}
      autoFocus={autoFocus}
      variant={variant}
      purpose={purpose}
      placement={placement}
      mcpAvailable={Boolean(mcpAvailable)}
      streaming={streaming}
      submitting={busy}
      animate={animate}
      showContextPreview={showContextPreview}
      contextParentId={contextParentId}
      sendLabel={sendLabel}
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
