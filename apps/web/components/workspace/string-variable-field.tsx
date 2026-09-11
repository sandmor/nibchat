"use client"

import { useState, type KeyboardEventHandler } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowExpand01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { MAX_PROMPT_CHARS } from "@/lib/limits"
import { cn } from "@/lib/utils"

export const STRING_VARIABLE_FOCUS_DIALOG_CLASS =
  "flex h-[100dvh] max-h-[100dvh] w-full max-w-none top-0 left-0 translate-x-0 translate-y-0 flex-col gap-3 rounded-none p-4 sm:top-1/2 sm:left-1/2 sm:h-[min(42rem,85dvh)] sm:max-h-[85dvh] sm:w-full sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-4xl sm:p-6"

export function StringVariableField({
  id,
  value,
  onChange,
  onBlur,
  onExpand,
  onKeyDown,
  placeholder,
  ariaLabel,
  disabled = false,
  compact = false,
  autoFocus = false,
  className,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  onExpand?: () => void
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
  compact?: boolean
  autoFocus?: boolean
  className?: string
}) {
  const textarea = (
    <Textarea
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      maxLength={MAX_PROMPT_CHARS}
      rows={compact ? 1 : undefined}
      aria-label={ariaLabel ?? placeholder}
      data-scrollbar={compact ? "none" : undefined}
      className={cn(
        compact
          ? "block max-h-24 min-h-9 overflow-y-auto overscroll-contain py-2 pe-9 leading-5"
          : "field-sizing-fixed h-auto min-h-[12rem] flex-1 overflow-y-auto",
        className
      )}
    />
  )
  if (!compact) return textarea
  return (
    <div className="relative">
      {textarea}
      {onExpand ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute top-1.5 right-1.5 size-7 text-muted-foreground hover:text-foreground"
          disabled={disabled}
          aria-label="Expand editor"
          title="Expand editor"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onExpand}
        >
          <HugeiconsIcon
            icon={ArrowExpand01Icon}
            strokeWidth={2}
            className="size-3.5"
          />
        </Button>
      ) : null}
    </div>
  )
}

export function StringVariableEditor({
  title,
  description,
  initialValue,
  defaultValue,
  onCommit,
  onCancel,
  onBack,
  disabled = false,
}: {
  title: string
  description?: string
  initialValue: string
  defaultValue?: string
  onCommit: (value: string) => void
  onCancel: () => void
  onBack?: () => void
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(initialValue)
  const [seen, setSeen] = useState(initialValue)
  if (initialValue !== seen) {
    setSeen(initialValue)
    setDraft(initialValue)
  }
  const canRevert = defaultValue !== undefined && draft !== defaultValue

  function commit() {
    onCommit(draft)
  }

  function revertToDefault() {
    if (defaultValue !== undefined) setDraft(defaultValue)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="sm:hidden"
          disabled={disabled}
          onClick={onBack ?? onCancel}
        >
          {onBack ? "Back" : "Cancel"}
        </Button>
        <DialogTitle className="min-w-0 flex-1 truncate text-center sm:text-left">
          {title}
        </DialogTitle>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="sm:hidden"
          disabled={disabled}
          onClick={commit}
        >
          Done
        </Button>
      </div>
      {description ? (
        <DialogDescription className="text-center sm:text-left">
          {description}
        </DialogDescription>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        <StringVariableField
          value={draft}
          onChange={setDraft}
          placeholder="Value"
          disabled={disabled}
          autoFocus
          className="min-h-0"
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              commit()
            }
          }}
        />
      </div>
      {canRevert ? (
        <button
          type="button"
          className="self-start text-xs text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          disabled={disabled}
          title={defaultValue}
          onClick={revertToDefault}
        >
          Use stack default
        </button>
      ) : null}
      <div className="mt-auto hidden shrink-0 items-center justify-end gap-2 sm:flex">
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="button" disabled={disabled} onClick={commit}>
          Done
        </Button>
      </div>
    </div>
  )
}

export function StringVariableFocusDialog({
  open,
  title,
  description,
  initialValue,
  defaultValue,
  onCommit,
  onOpenChange,
  disabled = false,
}: {
  open: boolean
  title: string
  description?: string
  initialValue: string
  defaultValue?: string
  onCommit: (value: string) => void
  onOpenChange: (open: boolean) => void
  disabled?: boolean
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false)
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={STRING_VARIABLE_FOCUS_DIALOG_CLASS}
      >
        {open ? (
          <StringVariableEditor
            key={title}
            title={title}
            description={description}
            initialValue={initialValue}
            defaultValue={defaultValue}
            disabled={disabled}
            onCommit={(value) => {
              onCommit(value)
              onOpenChange(false)
            }}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
