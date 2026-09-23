"use client"

import type { DragEventHandler, ReactNode } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowExpand01Icon,
  ArrowShrink01Icon,
  Loading03Icon,
  SentIcon,
  StopIcon,
  ArrowDown01Icon,
  Clock01Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { TooltipProvider, WithTooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export function EditorShell({
  variant = "docked",
  submitting = false,
  animate = true,
  dropActive = false,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
  contextPreview,
  footerStart,
  sendLabel = "Send",
  sendDisabled,
  onSend,
  onSchedule,
  scheduleAvailable = true,
  scheduleDisabled = false,
  scheduleLabel = "Generate later…",
  onCancel,
  onStop,
  streaming,
  hint,
  expandable = true,
  expanded = false,
  onToggleExpanded,
  onReplace,
  replaceLabel,
  replaceDisabled,
}: {
  variant?: "docked" | "inline"
  submitting?: boolean
  animate?: boolean
  dropActive?: boolean
  onDragEnter?: DragEventHandler<HTMLDivElement>
  onDragOver?: DragEventHandler<HTMLDivElement>
  onDragLeave?: DragEventHandler<HTMLDivElement>
  onDrop?: DragEventHandler<HTMLDivElement>
  children: ReactNode
  contextPreview?: ReactNode
  footerStart?: ReactNode
  sendLabel?: string
  sendDisabled: boolean
  onSend: () => void
  onSchedule?: () => void
  scheduleAvailable?: boolean
  /** Keeps the chevron in place while this draft cannot be scheduled yet. */
  scheduleDisabled?: boolean
  scheduleLabel?: string
  onCancel?: () => void
  onStop?: () => void
  streaming?: boolean
  hint?: string
  expandable?: boolean
  expanded?: boolean
  onToggleExpanded?: () => void
  onReplace?: () => void
  replaceLabel?: string
  replaceDisabled?: boolean
}) {
  const inline = variant === "inline"
  const showSchedule = Boolean(onSchedule) && scheduleAvailable
  return (
    <div
      data-theme-group="composer"
      data-theme-target="composer"
      data-tree-chrome={inline ? true : undefined}
      className={cn(
        "relative flex flex-col rounded-xl border border-composer-border bg-composer p-2 text-composer-foreground",
        inline && "shadow-[var(--tree-shadow-lg)]",
        dropActive ? "border-foreground/40 bg-muted/40" : null
      )}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dropActive ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl bg-background/70 text-sm text-muted-foreground">
          Drop images or PDFs
        </div>
      ) : null}
      {children}
      {contextPreview ? <div className="shrink-0">{contextPreview}</div> : null}
      <div className="flex shrink-0 items-center justify-between gap-2 px-2 pb-1">
        <TooltipProvider delay={400}>
          <div className="flex flex-wrap items-center gap-1">
            {footerStart}
            {expandable ? (
              <WithTooltip
                label={expanded ? "Collapse composer" : "Expand composer"}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-7"
                  aria-label={
                    expanded ? "Collapse composer" : "Expand composer"
                  }
                  aria-pressed={expanded}
                  disabled={submitting}
                  onClick={onToggleExpanded}
                >
                  <HugeiconsIcon
                    icon={expanded ? ArrowShrink01Icon : ArrowExpand01Icon}
                    strokeWidth={2}
                    className="size-3.5"
                  />
                </Button>
              </WithTooltip>
            ) : null}
            {hint ? (
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                {hint}
              </span>
            ) : null}
          </div>
        </TooltipProvider>
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
          {onReplace ? (
            <Button
              type="button"
              variant="outline"
              size={inline ? "xs" : "sm"}
              onClick={onReplace}
              disabled={replaceDisabled ?? sendDisabled}
            >
              {replaceLabel ?? "Replace"}
            </Button>
          ) : null}
          <div
            className={cn(
              "flex items-center",
              onSchedule &&
                showSchedule &&
                "isolate rounded-4xl bg-primary transition-colors duration-150 has-[[aria-expanded=true]]:bg-button-hover has-[button:enabled:hover]:bg-button-hover has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring/50 has-[button:focus-visible]:ring-offset-2 has-[button:focus-visible]:ring-offset-composer"
            )}
          >
            <Button
              size={inline ? "xs" : "sm"}
              className={cn(
                "gap-1.5",
                onSchedule &&
                  showSchedule &&
                  "relative rounded-r-none border-0 bg-transparent pr-2 hover:bg-transparent focus-visible:ring-0 active:translate-y-0"
              )}
              onClick={onSend}
              disabled={sendDisabled}
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
              {sendLabel}
            </Button>
            {showSchedule ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      size={inline ? "icon-xs" : "icon-sm"}
                      className="relative rounded-l-none border-0 bg-transparent before:pointer-events-none before:absolute before:inset-y-2 before:left-0 before:w-px before:rounded-full before:bg-primary-foreground/15 hover:bg-transparent focus-visible:ring-0"
                      disabled={sendDisabled || scheduleDisabled}
                      aria-label="Send options"
                    />
                  }
                >
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    className="size-3.5"
                    strokeWidth={2}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top">
                  <DropdownMenuItem onClick={() => onSchedule?.()}>
                    <HugeiconsIcon
                      icon={Clock01Icon}
                      className="size-4"
                      strokeWidth={2}
                    />
                    {scheduleLabel}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
