"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Tick02Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { SpaceLockSource } from "@/lib/space"
import { LockedPickerTrigger } from "./space-lock-hint"
import { useMediaMdUp } from "./hooks"

export type ChatTemplateOption = {
  id: string
  name: string
  nodeCount: number
}

function nodeCountLabel(count: number) {
  return `${count} message${count === 1 ? "" : "s"}`
}

export function chatTemplatePickerLabel(
  templates: readonly ChatTemplateOption[],
  value: string | null
) {
  if (!value) return "Template"
  return (
    templates.find((template) => template.id === value)?.name ??
    "Missing template"
  )
}

export function ChatTemplatePicker({
  templates,
  value,
  onSelect,
  lockedBy,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: {
  templates: ChatTemplateOption[]
  value: string | null
  onSelect: (templateId: string | null) => void
  lockedBy?: SpaceLockSource
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}) {
  const router = useRouter()
  const mdUp = useMediaMdUp()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : uncontrolledOpen
  function setOpen(next: boolean) {
    if (!controlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  const selected = value
    ? templates.find((template) => template.id === value)
    : null
  const missing = Boolean(value) && !selected
  const label = chatTemplatePickerLabel(templates, value)
  const locked = Boolean(lockedBy)

  function choose(templateId: string | null) {
    if (locked) return
    onSelect(templateId)
    setOpen(false)
  }

  const listBody = (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Seed this chat with a saved conversation tree, including branches.
      </p>
      {missing ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          That template was removed. Pick another, or start blank.
        </p>
      ) : null}
      <ul className="max-h-60 space-y-1 overflow-y-auto">
        <li>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-muted",
              !value && "bg-muted"
            )}
            onClick={() => choose(null)}
          >
            <span className="min-w-0 flex-1 truncate">Blank chat</span>
            {!value ? (
              <HugeiconsIcon
                icon={Tick02Icon}
                strokeWidth={2}
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
            ) : null}
          </button>
        </li>
        {templates.map((template) => {
          const active = value === template.id
          return (
            <li key={template.id}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-muted",
                  active && "bg-muted"
                )}
                onClick={() => choose(template.id)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{template.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {nodeCountLabel(template.nodeCount)}
                  </span>
                </span>
                {active ? (
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    strokeWidth={2}
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
      {templates.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Save a conversation from its menu, then pick it here.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 border-t pt-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-xs"
          onClick={() => {
            setOpen(false)
            router.push("/settings")
          }}
        >
          Edit in Settings
        </Button>
      </div>
    </div>
  )

  if (hideTrigger) {
    if (locked) return null
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Chat template</DialogTitle>
          </DialogHeader>
          {listBody}
        </DialogContent>
      </Dialog>
    )
  }

  if (locked && lockedBy) {
    return <LockedPickerTrigger lock={lockedBy} label={label} />
  }

  if (mdUp) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "max-w-[min(9rem,24vw)] min-w-0 truncate",
                missing && "text-destructive"
              )}
              title={label}
              aria-label={`Chat template: ${label}`}
            />
          }
        >
          <span className="truncate">{label}</span>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-3">
          {listBody}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          "max-w-[9rem] min-w-0 truncate px-2",
          missing && "text-destructive"
        )}
        onClick={() => setOpen(true)}
        title={label}
        aria-label={`Chat template: ${label}`}
      >
        <span className="truncate">Template</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Chat template</DialogTitle>
          </DialogHeader>
          {listBody}
        </DialogContent>
      </Dialog>
    </>
  )
}
