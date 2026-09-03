"use client"

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AttachmentIcon,
  Loading03Icon,
  Pdf02Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { WithTooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { ContextPreviewStrip } from "../context-preview"
import type {
  ComposerAttachment,
  ComposerDraft,
} from "../conversation-session-store"
import {
  applyFieldHeightCap,
  editorFieldMaxHeight,
  editorFieldMinHeight,
  fieldOverflow,
  fieldOverflowEqual,
  type EditorPlacement,
  type EditorPurpose,
} from "./layout"
import { EditorShell } from "./shell"

export function UserTurnEditor({
  draft,
  placeholder,
  autoFocus,
  variant = "docked",
  mcpAvailable,
  streaming,
  submitting = false,
  animate = true,
  showContextPreview = false,
  contextParentId = null,
  onTextChange,
  onSend,
  onCancel,
  onFiles,
  onRemoveAttachment,
  onPreview,
  onOpenResources,
  onOpenPrompts,
  onStop,
  onRevealContextMessage,
  sendLabel = "Send",
  purpose = "compose",
  placement = "linear",
}: {
  draft: ComposerDraft
  placeholder: string
  autoFocus?: boolean
  variant?: "docked" | "inline"
  mcpAvailable: boolean
  streaming?: boolean
  submitting?: boolean
  animate?: boolean
  showContextPreview?: boolean
  contextParentId?: string | null
  onTextChange: (text: string) => void
  onSend: () => void
  onCancel?: () => void
  onFiles: (files: File[] | FileList) => void
  onRemoveAttachment: (part: ComposerAttachment) => void
  onPreview: (src: string, name: string) => void
  onOpenResources: () => void
  onOpenPrompts: () => void
  onStop?: () => void
  onRevealContextMessage?: (nodeId: string) => void
  sendLabel?: string
  purpose?: EditorPurpose
  placement?: EditorPlacement
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [mcpMenuOpen, setMcpMenuOpen] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const dropDepthRef = useRef(0)
  const expandable = purpose === "compose"
  const showMcp =
    mcpAvailable ||
    draft.attachments.some((item) => item.reference.kind === "mcp-resource")
  const inline = variant === "inline"
  const sendDisabled =
    submitting ||
    (!draft.text.trim() && draft.attachments.length === 0) ||
    draft.attachments.some((attachment) => attachment.uploading)
  const send = () => {
    if (expandable) setExpanded(false)
    onSend()
  }

  return (
    <EditorShell
      variant={variant}
      submitting={submitting}
      animate={animate}
      dropActive={dropActive}
      onDragEnter={(event) => {
        event.preventDefault()
        dropDepthRef.current += 1
        setDropActive(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault()
        dropDepthRef.current = Math.max(0, dropDepthRef.current - 1)
        if (dropDepthRef.current === 0) setDropActive(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        dropDepthRef.current = 0
        setDropActive(false)
        if (event.dataTransfer.files.length) onFiles(event.dataTransfer.files)
      }}
      contextPreview={
        showContextPreview ? (
          <ContextPreviewStrip
            contextParentId={contextParentId}
            draft={draft}
            streaming={Boolean(streaming && onStop)}
            onRevealMessage={onRevealContextMessage}
          />
        ) : null
      }
      footerStart={
        <>
          <WithTooltip label="Attach file">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-7"
              aria-label="Attach file"
              disabled={submitting}
              onClick={() => fileInputRef.current?.click()}
            >
              <HugeiconsIcon
                icon={AttachmentIcon}
                strokeWidth={2}
                className="size-3.5"
              />
            </Button>
          </WithTooltip>
          {showMcp ? (
            <Popover open={mcpMenuOpen} onOpenChange={setMcpMenuOpen}>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={submitting}
                  />
                }
              >
                MCP
                {draft.attachments.some(
                  (item) => item.reference.kind === "mcp-resource"
                ) ? (
                  <span className="ml-1 text-muted-foreground">
                    ·{" "}
                    {
                      draft.attachments.filter(
                        (item) => item.reference.kind === "mcp-resource"
                      ).length
                    }
                  </span>
                ) : null}
              </PopoverTrigger>
              <PopoverContent
                align="start"
                side="top"
                className="w-72 gap-0.5 p-1.5"
              >
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left hover:bg-muted/70"
                  onClick={() => {
                    setMcpMenuOpen(false)
                    onOpenResources()
                  }}
                >
                  <span className="text-sm font-medium">Attach resource</span>
                  <span className="text-xs text-muted-foreground">
                    Pull docs or files from an MCP server into this message
                  </span>
                </button>
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left hover:bg-muted/70"
                  onClick={() => {
                    setMcpMenuOpen(false)
                    onOpenPrompts()
                  }}
                >
                  <span className="text-sm font-medium">Insert prompt</span>
                  <span className="text-xs text-muted-foreground">
                    Paste a server prompt template into the composer
                  </span>
                </button>
              </PopoverContent>
            </Popover>
          ) : null}
        </>
      }
      sendLabel={sendLabel}
      sendDisabled={sendDisabled}
      onSend={send}
      onCancel={onCancel}
      onStop={onStop}
      streaming={streaming}
      hint={
        expandable && !inline
          ? expanded
            ? "Esc to collapse · Enter to send"
            : "Enter to send · Shift + Enter for a new line"
          : undefined
      }
      expandable={expandable}
      expanded={expanded}
      onToggleExpanded={
        expandable ? () => setExpanded((open) => !open) : undefined
      }
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.pdf"
        multiple
        disabled={submitting}
        className="sr-only"
        onChange={(event) => {
          if (event.target.files) onFiles(event.target.files)
          event.target.value = ""
        }}
      />
      {draft.attachments.length > 0 ? (
        <div
          data-tree-scroll={inline ? "" : undefined}
          className="flex max-h-20 [touch-action:pan-y] flex-wrap items-end gap-1.5 overflow-y-auto overscroll-contain px-2 pt-1"
        >
          {draft.attachments.map((part) => {
            const key =
              part.reference.kind === "mcp-resource"
                ? `${part.reference.profileId}:${part.reference.uri}`
                : part.reference.id
            if (part.previewUrl) {
              return (
                <ComposerFileTile
                  key={key}
                  name={part.name}
                  uploading={part.uploading}
                  submitting={submitting}
                  animate={animate}
                  onRemove={() => onRemoveAttachment(part)}
                >
                  <button
                    type="button"
                    className="size-14 overflow-hidden rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    onClick={() => onPreview(part.previewUrl!, part.name)}
                  >
                    <img
                      src={part.previewUrl}
                      alt={part.name}
                      className="size-full object-cover"
                    />
                  </button>
                </ComposerFileTile>
              )
            }
            if (part.reference.kind === "uploaded-file") {
              const href = part.uploading
                ? undefined
                : `/api/attachments/${part.reference.id}`
              const preview = (
                <span className="flex size-14 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border bg-muted/50 px-1">
                  <HugeiconsIcon
                    icon={Pdf02Icon}
                    strokeWidth={2}
                    className="size-5 text-muted-foreground"
                  />
                  <span className="w-full truncate text-center text-[9px] leading-tight text-muted-foreground">
                    {part.name}
                  </span>
                </span>
              )
              return (
                <ComposerFileTile
                  key={key}
                  name={part.name}
                  uploading={part.uploading}
                  submitting={submitting}
                  animate={animate}
                  onRemove={() => onRemoveAttachment(part)}
                >
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      title={part.name}
                      className="block size-14 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {preview}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : (
                    <span title={part.name}>{preview}</span>
                  )}
                </ComposerFileTile>
              )
            }
            return (
              <span
                key={key}
                className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-xs"
              >
                Attached: {part.name}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${part.name}`}
                  onClick={() => onRemoveAttachment(part)}
                  disabled={submitting}
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
      ) : null}
      <UserTurnField
        autoFocus={autoFocus}
        disabled={submitting}
        value={draft.text}
        placeholder={placeholder}
        inline={inline}
        purpose={purpose}
        placement={placement}
        expanded={expandable && expanded}
        menuOpen={mcpMenuOpen}
        onChange={onTextChange}
        onSend={send}
        onCancel={onCancel}
        onFiles={onFiles}
        onCollapse={() => setExpanded(false)}
      />
    </EditorShell>
  )
}

function UserTurnField({
  autoFocus,
  disabled,
  value,
  placeholder,
  inline,
  purpose,
  placement,
  expanded,
  menuOpen,
  onChange,
  onSend,
  onCancel,
  onFiles,
  onCollapse,
}: {
  autoFocus?: boolean
  disabled: boolean
  value: string
  placeholder: string
  inline: boolean
  purpose: EditorPurpose
  placement: EditorPlacement
  expanded: boolean
  menuOpen: boolean
  onChange: (text: string) => void
  onSend: () => void
  onCancel?: () => void
  onFiles: (files: File[] | FileList) => void
  onCollapse: () => void
}) {
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const surface = inline ? "inline" : "docked"
  const expandable = purpose === "compose"
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
  }, [syncField, expanded, value])

  useLayoutEffect(() => {
    const el = fieldRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(syncField)
    observer.observe(el)
    return () => observer.disconnect()
  }, [syncField])

  return (
    <div className="relative min-h-0">
      <Textarea
        ref={fieldRef}
        data-composer-field=""
        data-tree-scroll={inline ? "" : undefined}
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={syncField}
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.nativeEvent.isComposing) return
          if (event.key === "Escape") {
            if (menuOpen) return
            if (expandable && expanded) {
              event.preventDefault()
              event.stopPropagation()
              onCollapse()
              return
            }
            if (!onCancel) return
            event.preventDefault()
            event.stopPropagation()
            onCancel()
            return
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            if (event.repeat || disabled) return
            onSend()
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files)
          if (files.length) {
            event.preventDefault()
            onFiles(files)
          }
        }}
        rows={3}
        style={{
          minHeight: editorFieldMinHeight({ purpose, surface, expanded }),
          maxHeight: editorFieldMaxHeight({
            purpose,
            surface,
            placement,
            expanded,
          }),
          overflowY: "auto",
        }}
        className="[touch-action:pan-y] resize-none overflow-y-auto overscroll-contain border-0 bg-transparent px-2 py-1 shadow-none focus-visible:ring-0"
      />
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

function ComposerFileTile({
  name,
  uploading,
  submitting,
  animate,
  onRemove,
  children,
}: {
  name: string
  uploading?: boolean
  submitting?: boolean
  animate: boolean
  onRemove: () => void
  children: ReactNode
}) {
  return (
    <span className="relative size-14 shrink-0" aria-busy={uploading}>
      {children}
      {uploading ? (
        <span className="pointer-events-none absolute inset-0 grid place-items-center rounded-md bg-background/60">
          <HugeiconsIcon
            icon={Loading03Icon}
            strokeWidth={2}
            className={cn("size-4", animate && "animate-spin")}
            style={{
              animationDuration: "var(--motion-spinner-duration)",
            }}
          />
        </span>
      ) : null}
      <button
        type="button"
        className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full border bg-background text-xs leading-none text-muted-foreground hover:text-foreground"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
        disabled={submitting}
      >
        ×
      </button>
    </span>
  )
}
