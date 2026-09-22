"use client"

import { useMemo, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Folder01Icon,
  Tick02Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons"
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
import { spaceChain, spaceFromRow, spacesById } from "@/lib/spaces"
import type { SpaceRow } from "@/lib/types"
import { useMediaMdUp } from "./hooks"

export function SpacePicker({
  spaces,
  value,
  onSelect,
  triggerLabel = "Move to…",
  showMembership = false,
  menuLabel,
  appearance = "toolbar",
  disabled,
  open: openProp,
  onOpenChange,
  hideTrigger,
  className,
}: {
  spaces: SpaceRow[]
  value?: string | null
  onSelect: (spaceId: string | null) => void
  triggerLabel?: string
  /** Show the current space instead of a "Move to…" verb. */
  showMembership?: boolean
  /** Popover heading. Defaults to "Move this chat" when showing membership. */
  menuLabel?: string
  /** `field` is a full-width form control. `toolbar` is the compact chat-header button. */
  appearance?: "toolbar" | "field"
  disabled?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
  className?: string
}) {
  const mdUp = useMediaMdUp()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : uncontrolledOpen
  function setOpen(next: boolean) {
    if (!controlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const records = useMemo(() => spaces.map(spaceFromRow), [spaces])
  const byId = useMemo(() => spacesById(records), [records])
  const selected = value ? byId.get(value) : null
  const label = selected ? selected.name : "Ungrouped"
  const triggerText = showMembership ? label : triggerLabel
  const triggerAria = showMembership
    ? `Space: ${label}`
    : `${triggerLabel} ${label}`
  const heading = menuLabel ?? (showMembership ? "Move this chat" : null)
  const field = appearance === "field"

  function choose(spaceId: string | null) {
    onSelect(spaceId)
    setOpen(false)
  }

  const options = [
    { id: null as string | null, label: "Ungrouped", indent: 0 },
    ...spaces
      .map((space) => {
        const depth = Math.max(0, spaceChain(space.id, byId).length - 1)
        return { id: space.id, label: space.name, indent: depth }
      })
      .sort((left, right) => {
        const leftChain = spaceChain(left.id, byId)
          .map((item) => item.name)
          .join("/")
        const rightChain = spaceChain(right.id, byId)
          .map((item) => item.name)
          .join("/")
        return leftChain.localeCompare(rightChain)
      }),
  ]

  const list = (
    <ul className="max-h-60 space-y-0.5 overflow-y-auto">
      {options.map((option) => {
        const active = value !== undefined && value === option.id
        return (
          <li key={option.id ?? "ungrouped"}>
            <button
              type="button"
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-xl py-2 pr-3 text-left text-sm transition-colors hover:bg-muted",
                active && "bg-muted"
              )}
              style={{ paddingInlineStart: `${10 + option.indent * 14}px` }}
              onClick={() => choose(option.id)}
            >
              <HugeiconsIcon
                icon={Folder01Icon}
                strokeWidth={2}
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground",
                  option.id == null && "opacity-40"
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
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
  )

  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{triggerLabel}</DialogTitle>
        </DialogHeader>
        {list}
      </DialogContent>
    </Dialog>
  )

  if (hideTrigger) return dialog

  const trigger = (
    <>
      <HugeiconsIcon
        icon={Folder01Icon}
        strokeWidth={2}
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="truncate">{triggerText}</span>
      {field ? (
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          strokeWidth={2}
          className="ms-auto size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      ) : null}
    </>
  )

  if (mdUp) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant={field ? "outline" : "ghost"}
              size={field ? "default" : "sm"}
              disabled={disabled}
              className={cn(
                field
                  ? "h-9 w-full max-w-none justify-start px-3"
                  : "max-w-[min(8rem,22vw)] min-w-0 gap-1 px-2",
                className
              )}
              aria-label={triggerAria}
            />
          }
        >
          {trigger}
        </PopoverTrigger>
        <PopoverContent
          align={field ? "start" : "end"}
          className={cn("p-3", field ? "w-80" : "w-72")}
        >
          {heading ? (
            <p className="mb-2 text-xs text-muted-foreground">{heading}</p>
          ) : null}
          {list}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <>
      <Button
        type="button"
        variant={field ? "outline" : "ghost"}
        size={field ? "default" : "sm"}
        disabled={disabled}
        className={cn(
          field
            ? "h-9 w-full max-w-none justify-start px-3"
            : "max-w-[8rem] min-w-0 gap-1 px-2",
          className
        )}
        aria-label={triggerAria}
        onClick={() => setOpen(true)}
      >
        {trigger}
      </Button>
      {dialog}
    </>
  )
}
