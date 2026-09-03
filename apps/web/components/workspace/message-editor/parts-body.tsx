"use client"

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import { applyMessageEdits } from "@/lib/agent/parts"
import type { Parts } from "@/lib/types"
import { ContextPreviewStrip } from "../context-preview"
import type { MessageEditDraft } from "../conversation-session-store"
import { MessageParts } from "../message-parts"
import {
  applyFieldHeightCap,
  editorFieldMaxHeight,
  editorFieldMinHeight,
  fieldOverflow,
  fieldOverflowEqual,
  type EditorPlacement,
} from "./layout"
import { EditorShell } from "./shell"

export function PartsEditor({
  parts,
  edits,
  onEditChange,
  overlayNodeId,
  variant = "inline",
  submitting = false,
  animate = true,
  showContextPreview = false,
  onSend,
  onCancel,
  onRevealContextMessage,
  sendLabel = "Save branch",
  placement = "linear",
}: {
  parts: Parts
  edits: MessageEditDraft
  onEditChange: (index: number, text: string) => void
  overlayNodeId: string
  variant?: "docked" | "inline"
  submitting?: boolean
  animate?: boolean
  showContextPreview?: boolean
  onSend: () => void
  onCancel?: () => void
  onRevealContextMessage?: (nodeId: string) => void
  sendLabel?: string
  placement?: EditorPlacement
}) {
  const sendDisabled =
    submitting ||
    !edits.some((segment) => segment.type === "text" && segment.text.trim())
  const send = () => {
    if (sendDisabled) return
    onSend()
  }
  const overlay = useMemo(() => {
    try {
      return {
        nodeId: overlayNodeId,
        parts: applyMessageEdits(parts, edits),
      }
    } catch {
      return undefined
    }
  }, [overlayNodeId, parts, edits])

  return (
    <EditorShell
      variant={variant}
      submitting={submitting}
      animate={animate}
      contextPreview={
        showContextPreview ? (
          <ContextPreviewStrip
            contextParentId={overlayNodeId}
            overlay={overlay}
            onRevealMessage={onRevealContextMessage}
          />
        ) : null
      }
      sendLabel={sendLabel}
      sendDisabled={sendDisabled}
      onSend={send}
      onCancel={onCancel}
      hint="⌘/Ctrl + Enter to save · Esc to cancel"
      expandable={false}
    >
      <PartsField
        inline={variant === "inline"}
        placement={placement}
        disabled={submitting}
        onSend={send}
        onCancel={onCancel}
      >
        <MessageParts
          parts={parts}
          editing
          edits={edits}
          onEditChange={onEditChange}
        />
      </PartsField>
    </EditorShell>
  )
}

function PartsField({
  inline,
  placement,
  disabled,
  onSend,
  onCancel,
  children,
}: {
  inline: boolean
  placement: EditorPlacement
  disabled: boolean
  onSend: () => void
  onCancel?: () => void
  children: React.ReactNode
}) {
  const fieldRef = useRef<HTMLDivElement>(null)
  const surface = inline ? "inline" : "docked"
  const [overflow, setOverflow] = useState(
    fieldOverflow({
      scrollTop: 0,
      scrollHeight: 0,
      clientHeight: 0,
    })
  )

  const syncField = useCallback(() => {
    const el = fieldRef.current
    if (!el) return
    applyFieldHeightCap(el)
    const next = fieldOverflow(el)
    setOverflow((prev) => (fieldOverflowEqual(prev, next) ? prev : next))
  }, [])

  useLayoutEffect(() => {
    syncField()
  }, [syncField, children])

  useLayoutEffect(() => {
    const el = fieldRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(syncField)
    observer.observe(el)
    return () => observer.disconnect()
  }, [syncField])

  return (
    <div className="relative min-h-0">
      <div
        ref={fieldRef}
        data-composer-field=""
        data-tree-scroll={inline ? "" : undefined}
        tabIndex={-1}
        onScroll={syncField}
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.nativeEvent.isComposing) return
          if (event.key === "Escape") {
            if (!onCancel) return
            event.preventDefault()
            event.stopPropagation()
            onCancel()
            return
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            if (event.repeat || disabled) return
            onSend()
          }
        }}
        style={{
          minHeight: editorFieldMinHeight({
            purpose: "edit",
            surface,
          }),
          maxHeight: editorFieldMaxHeight({
            purpose: "edit",
            surface,
            placement,
          }),
          overflowY: "auto",
        }}
        className="[touch-action:pan-y] overflow-y-auto overscroll-contain px-2 py-1"
      >
        {children}
      </div>
      {overflow.top ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-composer to-transparent"
        />
      ) : null}
      {overflow.bottom ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-composer to-transparent"
        />
      ) : null}
    </div>
  )
}
