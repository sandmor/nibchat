"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
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
import { isOrphanPromptStackRef } from "@/lib/prompt-stack"
import { cn } from "@/lib/utils"
import type { SpaceLockSource } from "@/lib/space"
import { LockedPickerTrigger } from "./space-lock-hint"
import { useTRPC } from "@/lib/trpc-react"
import { useMediaMdUp } from "./hooks"

export function PromptStackPicker({
  chatId,
  promptStackId,
  onChanged,
  draftStackId,
  onDraftChange,
  lockedBy,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: {
  chatId?: string
  /** Chat's prompt_stack_id (null = inherit). */
  promptStackId: string | null
  onChanged?: () => void | Promise<void>
  /** Draft chats before first message: local-only selection. */
  draftStackId?: string | null
  onDraftChange?: (stackId: string | null) => void
  lockedBy?: SpaceLockSource
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}) {
  const trpc = useTRPC()
  const router = useRouter()
  const mdUp = useMediaMdUp()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : uncontrolledOpen
  function setOpen(next: boolean) {
    if (!controlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  const settingsQuery = useQuery(trpc.workspace.getSettings.queryOptions())
  const stacks = settingsQuery.data?.promptStacks ?? []
  const defaultId = settingsQuery.data?.defaultPromptStackId ?? null
  const defaultStack = stacks.find((s) => s.id === defaultId)

  const activeRef = chatId ? promptStackId : (draftStackId ?? null)
  const selectedStack = activeRef
    ? stacks.find((s) => s.id === activeRef)
    : null
  const isOrphan = isOrphanPromptStackRef(activeRef, stacks)
  const inherits = activeRef === null

  const label = inherits
    ? defaultStack
      ? `Stack · ${defaultStack.name}`
      : "Prompt stack"
    : isOrphan
      ? "Missing stack"
      : (selectedStack?.name ?? "Prompt stack")

  const setMut = useMutation(
    trpc.workspace.setChatPromptStack.mutationOptions({
      onSuccess: async () => {
        toast.success("Prompt stack updated")
        await onChanged?.()
        setOpen(false)
      },
      onError: (e) => toast.error(e.message || "Could not update"),
    })
  )

  const locked = Boolean(lockedBy)

  async function selectStack(stackId: string | null) {
    if (locked) return
    if (!chatId) {
      onDraftChange?.(stackId)
      setOpen(false)
      return
    }
    await setMut.mutateAsync({ chatId, stackId })
  }

  const listBody = (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Shared stacks from Settings. This chat only stores a reference.
      </p>
      {isOrphan ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Previous stack was removed. Generations use the instance default until
          you pick another.
        </p>
      ) : null}
      <ul className="max-h-60 space-y-1 overflow-y-auto">
        <li>
          <button
            type="button"
            className={cn(
              "flex w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-muted",
              inherits && "bg-muted"
            )}
            onClick={() => void selectStack(null)}
          >
            <span className="min-w-0 flex-1 truncate">
              Instance default
              {defaultStack ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {defaultStack.name}
                </span>
              ) : null}
            </span>
          </button>
        </li>
        {stacks.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className={cn(
                "flex w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-muted",
                activeRef === s.id && "bg-muted"
              )}
              onClick={() => void selectStack(s.id)}
            >
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              {s.id === defaultId ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  default
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
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
            <DialogTitle>Prompt stack</DialogTitle>
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
                isOrphan && "text-destructive"
              )}
              title={label}
              aria-label={`Prompt stack: ${label}`}
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
          isOrphan && "text-destructive"
        )}
        onClick={() => setOpen(true)}
        title={label}
        aria-label={`Prompt stack: ${label}`}
      >
        <span className="truncate">Stack</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Prompt stack</DialogTitle>
          </DialogHeader>
          {listBody}
        </DialogContent>
      </Dialog>
    </>
  )
}
