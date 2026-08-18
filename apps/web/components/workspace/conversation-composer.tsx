"use client"

import { memo, useCallback, useMemo, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ImageAdd02Icon,
  Loading03Icon,
  SentIcon,
  StopIcon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { TooltipProvider, WithTooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  useComposerDraft,
  useConversationSessionStore,
  type ComposerAttachment,
  type ComposerDraft,
} from "./conversation-session-store"
import { ContextPreviewStrip } from "./context-preview"

export type ConversationComposerProps = {
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
}

export type SessionComposerProps = Omit<
  ConversationComposerProps,
  "draft" | "onTextChange"
> & { slot: string }

/**
 * Session-bound composer. The wrapper always runs with the parent so action
 * refs stay current; the leaf subscribes to one slot and ignores parent
 * re-renders that only change callback identity (stream tokens, queries).
 */
export function SessionComposer(props: SessionComposerProps) {
  const latestRef = useRef(props)
  latestRef.current = props
  return (
    <SessionComposerLeaf
      slot={props.slot}
      placeholder={props.placeholder}
      autoFocus={props.autoFocus}
      variant={props.variant}
      mcpAvailable={props.mcpAvailable}
      streaming={props.streaming}
      submitting={props.submitting}
      animate={props.animate}
      showContextPreview={props.showContextPreview}
      contextParentId={props.contextParentId}
      latestRef={latestRef}
    />
  )
}

const SessionComposerLeaf = memo(function SessionComposerLeaf({
  slot,
  placeholder,
  autoFocus,
  variant,
  mcpAvailable,
  streaming,
  submitting,
  animate,
  showContextPreview,
  contextParentId,
  latestRef,
}: {
  slot: string
  placeholder: string
  autoFocus?: boolean
  variant?: ConversationComposerProps["variant"]
  mcpAvailable: boolean
  streaming?: boolean
  submitting?: boolean
  animate?: boolean
  showContextPreview?: boolean
  contextParentId?: string | null
  latestRef: { current: SessionComposerProps }
}) {
  const draft = useComposerDraft(slot)
  const update = useConversationSessionStore((state) => state.update)
  const onTextChange = useCallback(
    (text: string) => update(slot, { text }),
    [slot, update]
  )
  const actions = useMemo(
    () => ({
      onSend: () => latestRef.current.onSend(),
      onCancel: () => latestRef.current.onCancel?.(),
      onFiles: (files: File[] | FileList) => latestRef.current.onFiles(files),
      onRemoveAttachment: (part: ComposerAttachment) =>
        latestRef.current.onRemoveAttachment(part),
      onPreview: (src: string, name: string) =>
        latestRef.current.onPreview(src, name),
      onOpenResources: () => latestRef.current.onOpenResources(),
      onOpenPrompts: () => latestRef.current.onOpenPrompts(),
      onStop: () => latestRef.current.onStop?.(),
      onRevealContextMessage: (nodeId: string) =>
        latestRef.current.onRevealContextMessage?.(nodeId),
    }),
    [latestRef]
  )
  return (
    <ConversationComposer
      draft={draft}
      placeholder={placeholder}
      autoFocus={autoFocus}
      variant={variant}
      mcpAvailable={mcpAvailable}
      streaming={streaming}
      submitting={submitting}
      animate={animate}
      showContextPreview={showContextPreview}
      contextParentId={contextParentId}
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

/**
 * Shared composer chrome. Linear docks one instance; Tree mounts one per
 * open plus node. Each caller owns its draft — this component is stateless
 * with respect to conversation text and attachments.
 */
export function ConversationComposer({
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
}: ConversationComposerProps) {
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [mcpMenuOpen, setMcpMenuOpen] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const dropDepthRef = useRef(0)
  const showMcp =
    mcpAvailable ||
    draft.attachments.some((item) => item.reference.kind === "mcp-resource")
  const inline = variant === "inline"
  const sending =
    submitting ||
    (!draft.text.trim() && draft.attachments.length === 0) ||
    draft.attachments.some((attachment) => attachment.uploading)

  return (
    <div
      data-theme-group="composer"
      data-theme-target="composer"
      data-tree-chrome={inline ? true : undefined}
      className={cn(
        "relative rounded-xl border border-composer-border bg-composer p-2 text-composer-foreground",
        inline &&
          "[touch-action:pan-x_pan-y] overflow-auto overscroll-contain shadow-[var(--tree-shadow-lg)]",
        dropActive ? "border-foreground/40 bg-muted/40" : null
      )}
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
    >
      {dropActive ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl bg-background/70 text-sm text-muted-foreground">
          Drop images
        </div>
      ) : null}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        disabled={submitting}
        className="sr-only"
        onChange={(event) => {
          if (event.target.files) onFiles(event.target.files)
          event.target.value = ""
        }}
      />
      {draft.attachments.length > 0 ? (
        <div className="flex flex-wrap items-end gap-1.5 px-2 pt-1">
          {draft.attachments.map((part) => {
            const key =
              part.reference.kind === "mcp-resource"
                ? `${part.reference.profileId}:${part.reference.uri}`
                : part.reference.id
            if (part.previewUrl) {
              return (
                <span key={key} className="relative size-14 shrink-0">
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
                  {part.uploading ? (
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
                    aria-label={`Remove ${part.name}`}
                    onClick={() => onRemoveAttachment(part)}
                    disabled={submitting}
                  >
                    ×
                  </button>
                </span>
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
      <Textarea
        autoFocus={autoFocus}
        disabled={submitting}
        value={draft.text}
        onChange={(event) => onTextChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            if (event.repeat || submitting) return
            onSend()
          }
        }}
        placeholder={placeholder}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files)
          if (files.length) {
            event.preventDefault()
            onFiles(files)
          }
        }}
        rows={3}
        className="min-h-[4.5rem] resize-none border-0 bg-transparent px-2 py-1 shadow-none focus-visible:ring-0"
      />
      {showContextPreview ? (
        <ContextPreviewStrip
          contextParentId={contextParentId}
          draft={draft}
          streaming={Boolean(streaming && onStop)}
          onRevealMessage={onRevealContextMessage}
        />
      ) : null}
      <div className="flex items-center justify-between gap-2 px-2 pb-1">
        <div className="flex flex-wrap items-center gap-1">
          <TooltipProvider delay={400}>
            <WithTooltip label="Attach image">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="size-7"
                aria-label="Attach image"
                disabled={submitting}
                onClick={() => imageInputRef.current?.click()}
              >
                <HugeiconsIcon
                  icon={ImageAdd02Icon}
                  strokeWidth={2}
                  className="size-3.5"
                />
              </Button>
            </WithTooltip>
          </TooltipProvider>
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
          {inline ? null : (
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              Enter to send · Shift + Enter for a new line
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {inline ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </Button>
          ) : streaming && onStop ? (
            <Button
              variant="destructive"
              size="sm"
              className="gap-1.5"
              onClick={onStop}
            >
              <HugeiconsIcon
                icon={StopIcon}
                strokeWidth={2}
                className="size-4"
              />
              Stop
            </Button>
          ) : null}
          <Button
            size={inline ? "xs" : "sm"}
            className="gap-1.5"
            onClick={onSend}
            disabled={sending}
          >
            {submitting ? (
              <HugeiconsIcon
                icon={Loading03Icon}
                strokeWidth={2}
                className={cn("size-3.5", animate && "animate-spin")}
                style={{
                  animationDuration: "var(--motion-spinner-duration)",
                }}
              />
            ) : inline ? null : (
              <HugeiconsIcon
                icon={SentIcon}
                strokeWidth={2}
                className="size-4"
              />
            )}
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
