"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Clock01Icon,
  Delete02Icon,
  Edit02Icon,
} from "@hugeicons/core-free-icons"
import { toast } from "sonner"
import { useTRPC } from "@/lib/trpc-react"
import { formatRunInstant } from "@/lib/schedules/cadence"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  ScheduleClockFields,
  cadenceFromClock,
  onceScheduleClock,
  scheduleClockError,
  type ScheduleClock,
} from "./schedule-dialog"
import type { NodeSchedule } from "@/lib/types"

export type PendingGeneration = {
  id: string
  parentId: string
  nextRunAt: string
  timeZone: string
}

type ScheduledGenerationContextValue = {
  available: boolean
  pending: readonly PendingGeneration[]
  openForNode: (nodeId: string) => void
  openPending: (scheduleId: string) => void
  cancel: (scheduleId: string) => void
}

const ScheduledGenerationContext =
  createContext<ScheduledGenerationContextValue | null>(null)

export function ScheduledGenerationProvider({
  value,
  children,
}: {
  value: ScheduledGenerationContextValue
  children: ReactNode
}) {
  return (
    <ScheduledGenerationContext.Provider value={value}>
      {children}
    </ScheduledGenerationContext.Provider>
  )
}

export function useScheduledGeneration() {
  return useContext(ScheduledGenerationContext)
}

export type ScheduledGenerationVerb = "Generates" | "Regenerates"

export function scheduledGenerationVerb(
  hasAssistantChild: boolean
): ScheduledGenerationVerb {
  return hasAssistantChild ? "Regenerates" : "Generates"
}

export function scheduledGenerationMenuLabel(hasAssistantChild: boolean) {
  return scheduledGenerationVerb(hasAssistantChild) === "Regenerates"
    ? "Regenerate later…"
    : "Generate later…"
}

export function scheduledGenerationLabel(
  nextRunAt: string,
  timeZone: string,
  verb: ScheduledGenerationVerb = "Generates"
) {
  return `${verb} ${formatRunInstant(nextRunAt, timeZone)}`
}

function scheduleActionClass(captions: boolean, destructive = false) {
  return cn(
    captions
      ? "h-7 gap-1 px-2 text-xs font-normal"
      : "size-7 text-muted-foreground hover:text-foreground",
    destructive && "text-destructive hover:text-destructive"
  )
}

export function ScheduledGenerationLane({
  items,
  verb = "Generates",
  captions,
  onOpen,
}: {
  items: readonly {
    scheduleId: string
    nextRunAt: string
    timeZone: string
  }[]
  verb?: ScheduledGenerationVerb
  captions: boolean
  onOpen: (scheduleId: string) => void
}) {
  const scheduledGeneration = useScheduledGeneration()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const found = items.findIndex((item) => item.scheduleId === selectedId)
  const index = found === -1 ? 0 : found
  const current = items[index]
  if (!current) return null
  const label = scheduledGenerationLabel(
    current.nextRunAt,
    current.timeZone,
    verb
  )
  return (
    <article
      data-testid="scheduled-generation"
      className="w-full min-w-0 rounded-xl border border-dashed border-message-assistant-border bg-message-assistant p-4 text-sm text-message-assistant-foreground"
    >
      <div className="flex items-center gap-2">
        <HugeiconsIcon
          icon={Clock01Icon}
          strokeWidth={2}
          className="size-3.5 shrink-0"
        />
        <span className="min-w-0">{label}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.length > 1 ? (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Previous scheduled generation"
              disabled={index === 0}
              onClick={() => setSelectedId(items[index - 1]!.scheduleId)}
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
            </Button>
            <span aria-live="polite">
              {index + 1}/{items.length}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Next scheduled generation"
              disabled={index === items.length - 1}
              onClick={() => setSelectedId(items[index + 1]!.scheduleId)}
            >
              <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
            </Button>
          </div>
        ) : null}
        <span className="min-w-0 flex-1" />
        <Button
          type="button"
          variant="ghost"
          size={captions ? "xs" : "icon-xs"}
          className={scheduleActionClass(captions)}
          aria-label="Edit schedule"
          onClick={() => onOpen(current.scheduleId)}
          {...(captions
            ? {}
            : {
                "data-static-tooltip": "Edit schedule",
                "data-static-tooltip-gap": "4",
              })}
        >
          <HugeiconsIcon
            icon={Edit02Icon}
            strokeWidth={2}
            className="size-3.5 shrink-0"
            aria-hidden
          />
          {captions ? <span className="leading-none">Edit</span> : null}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size={captions ? "xs" : "icon-xs"}
          className={cn(
            scheduleActionClass(captions),
            "hover:text-destructive"
          )}
          aria-label="Cancel schedule"
          onClick={() => scheduledGeneration?.cancel(current.scheduleId)}
          {...(captions
            ? {}
            : {
                "data-static-tooltip": "Cancel schedule",
                "data-static-tooltip-gap": "4",
              })}
        >
          <HugeiconsIcon
            icon={Delete02Icon}
            strokeWidth={2}
            className="size-3.5 shrink-0"
            aria-hidden
          />
          {captions ? <span className="leading-none">Cancel</span> : null}
        </Button>
      </div>
    </article>
  )
}

export function ScheduledGenerationCard({
  nextRunAt,
  timeZone,
  onOpen,
  onCancel,
  verb = "Generates",
  className,
}: {
  nextRunAt: string
  timeZone: string
  onOpen: () => void
  onCancel?: () => void
  verb?: ScheduledGenerationVerb
  className?: string
}) {
  const label = scheduledGenerationLabel(nextRunAt, timeZone, verb)
  return (
    <div className={cn("relative h-full min-h-0 w-full", className)}>
      <button
        type="button"
        data-testid="scheduled-generation"
        aria-label={label}
        onClick={onOpen}
        className="absolute inset-0 flex items-center gap-2 rounded-xl border border-dashed border-message-assistant-border bg-message-assistant px-3.5 pr-10 text-left text-sm text-message-assistant-foreground"
      >
        <HugeiconsIcon
          icon={Clock01Icon}
          strokeWidth={2}
          className="size-3.5 shrink-0"
        />
        <span className="truncate">{label}</span>
      </button>
      {onCancel ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Cancel schedule"
          className="absolute top-1.5 right-1.5 z-10 size-7 text-muted-foreground hover:text-destructive"
          onClick={onCancel}
        >
          <HugeiconsIcon
            icon={Delete02Icon}
            strokeWidth={2}
            className="size-3.5 shrink-0"
            aria-hidden
          />
        </Button>
      ) : null}
    </div>
  )
}

export function ScheduledGenerationDialog({
  schedule,
  onOpenChange,
}: {
  schedule: NodeSchedule | null
  onOpenChange: (open: boolean) => void
}) {
  const trpc = useTRPC()
  const client = useQueryClient()
  const [clock, setClock] = useState<ScheduleClock | null>(null)
  const [editedId, setEditedId] = useState<string | null>(null)
  const displayed =
    schedule && editedId === schedule.id && clock
      ? clock
      : schedule
        ? onceScheduleClock(schedule.nextRunAt, schedule.timeZone)
        : null
  async function refresh() {
    await Promise.all([
      client.invalidateQueries(trpc.workspace.listSchedules.queryFilter()),
      client.invalidateQueries(trpc.workspace.get.queryFilter()),
    ])
    onOpenChange(false)
  }
  const options = {
    onSuccess: refresh,
    onError: (error: { message: string }) => toast.error(error.message),
  }
  const run = useMutation(
    trpc.workspace.runScheduleNow.mutationOptions(options)
  )
  const update = useMutation(
    trpc.workspace.updateSchedule.mutationOptions(options)
  )
  const busy = run.isPending || update.isPending
  const clockError = displayed ? scheduleClockError(displayed) : null
  const savedClock = schedule
    ? onceScheduleClock(schedule.nextRunAt, schedule.timeZone)
    : null
  const clockDirty = Boolean(
    displayed &&
    savedClock &&
    (displayed.date !== savedClock.date ||
      displayed.time !== savedClock.time ||
      displayed.timeZone !== savedClock.timeZone)
  )
  return (
    <Dialog
      open={Boolean(schedule)}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false)
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Scheduled generation</DialogTitle>
          <DialogDescription>
            Change when this reply runs, or run it now.
          </DialogDescription>
        </DialogHeader>
        {displayed ? (
          <ScheduleClockFields
            clock={displayed}
            spaces={[]}
            onceOnly
            showSpace={false}
            onChange={(patch) => {
              if (!schedule) return
              setEditedId(schedule.id)
              setClock({ ...displayed, ...patch })
            }}
          />
        ) : null}
        <DialogFooter className="flex-col sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={busy || clockDirty || Boolean(clockError)}
            onClick={() => schedule && run.mutate({ id: schedule.id })}
          >
            Run now
          </Button>
          <Button
            type="button"
            disabled={busy || Boolean(clockError)}
            onClick={() => {
              const cadence = displayed && cadenceFromClock(displayed)
              if (schedule && cadence)
                update.mutate({ id: schedule.id, cadence, enabled: true })
            }}
          >
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
