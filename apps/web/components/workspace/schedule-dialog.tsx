"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TimeField } from "@/components/ui/time-field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MAX_NAME } from "@/lib/limits"
import {
  WEEKDAY_LABELS,
  followingRunAt,
  formatRunInstant,
  storeCadence,
  type Cadence,
  type CadenceInput,
} from "@/lib/schedules/cadence"
import type { SpaceRow } from "@/lib/types"
import { useTRPC } from "@/lib/trpc-react"
import { SpacePicker } from "./space-picker"

type CadenceKind = Cadence["kind"]

export type ScheduleDialogSchedule = {
  id: string
  name: string
  spaceId: string | null
  cadence: Cadence
}

export type ScheduleDialogSource =
  | {
      kind: "template"
      templateId: string
      templateName: string
      leafIsUser: boolean
    }
  | {
      kind: "edit"
      schedule: ScheduleDialogSchedule
    }

export type ScheduleClock = {
  spaceId: string | null
  kind: CadenceKind
  time: string
  weekday: number
  everyHours: number
  timeZone: string
}

type ScheduleForm = ScheduleClock & {
  name: string
}

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

function pad(value: number) {
  return String(value).padStart(2, "0")
}

function clockFromCadence(cadence: Cadence) {
  if (cadence.kind === "interval") return "09:00"
  return `${pad(cadence.hour)}:${pad(cadence.minute)}`
}

export function defaultScheduleClock(
  spaceId: string | null = null
): ScheduleClock {
  return {
    spaceId,
    kind: "daily",
    time: "09:00",
    weekday: new Date().getDay(),
    everyHours: 24,
    timeZone: browserTimeZone(),
  }
}

function emptyForm(partial: Partial<ScheduleForm> = {}): ScheduleForm {
  return {
    name: "",
    ...defaultScheduleClock(),
    ...partial,
  }
}

function formForSource(source: ScheduleDialogSource): ScheduleForm {
  if (source.kind === "edit") {
    const cadence = source.schedule.cadence
    return emptyForm({
      name: source.schedule.name,
      spaceId: source.schedule.spaceId,
      kind: cadence.kind,
      time: clockFromCadence(cadence),
      weekday:
        cadence.kind === "weekly" ? cadence.weekday : new Date().getDay(),
      everyHours: cadence.kind === "interval" ? cadence.everyHours : 24,
      timeZone: cadence.timeZone,
    })
  }
  return emptyForm({ name: source.templateName })
}

export function cadenceFromClock(clock: ScheduleClock): CadenceInput | null {
  if (clock.kind === "interval") {
    const everyHours = Math.trunc(clock.everyHours)
    if (everyHours < 1 || everyHours > 168) return null
    return { kind: "interval", everyHours, timeZone: clock.timeZone }
  }
  const [hourText, minuteText] = clock.time.split(":")
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  if (clock.kind === "weekly")
    return {
      kind: "weekly",
      weekday: clock.weekday,
      hour,
      minute,
      timeZone: clock.timeZone,
    }
  return { kind: "daily", hour, minute, timeZone: clock.timeZone }
}

function sourceKey(source: ScheduleDialogSource) {
  if (source.kind === "edit") return `edit:${source.schedule.id}`
  return `template:${source.templateId}`
}

export function ScheduleClockFields({
  clock,
  spaces,
  onChange,
}: {
  clock: ScheduleClock
  spaces: SpaceRow[]
  onChange: (patch: Partial<ScheduleClock>) => void
}) {
  const cadence = cadenceFromClock(clock)
  const preview = cadence
    ? `Next ${formatRunInstant(
        followingRunAt(
          storeCadence(cadence, new Date()),
          new Date()
        ).toISOString(),
        clock.timeZone
      )}`
    : null
  const kindItems = {
    daily: "Daily",
    weekly: "Weekly",
    interval: "Every few hours",
  }
  const weekdayItems = Object.fromEntries(
    WEEKDAY_LABELS.map((label, weekday) => [String(weekday), label])
  )
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div
          className={
            clock.kind === "daily"
              ? "grid gap-1.5 sm:col-span-2"
              : "grid gap-1.5"
          }
        >
          <Label htmlFor="schedule-kind">When</Label>
          <Select
            value={clock.kind}
            items={kindItems}
            onValueChange={(kind) => {
              if (kind === "daily" || kind === "weekly" || kind === "interval")
                onChange({ kind })
            }}
          >
            <SelectTrigger id="schedule-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="interval">Every few hours</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {clock.kind === "weekly" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="schedule-weekday">Weekday</Label>
            <Select
              value={String(clock.weekday)}
              items={weekdayItems}
              onValueChange={(weekday) => {
                if (weekday) onChange({ weekday: Number(weekday) })
              }}
            >
              <SelectTrigger id="schedule-weekday" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEKDAY_LABELS.map((label, weekday) => (
                  <SelectItem key={label} value={String(weekday)}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {clock.kind === "interval" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="schedule-hours">Hours between runs</Label>
            <Input
              id="schedule-hours"
              type="number"
              min={1}
              max={168}
              value={clock.everyHours}
              onChange={(event) =>
                onChange({ everyHours: Number(event.target.value) })
              }
            />
          </div>
        ) : (
          <div className="sm:col-span-2">
            <TimeField
              id="schedule-time"
              value={clock.time}
              onChange={(time) => onChange({ time })}
            />
          </div>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label>New chats land in</Label>
        <SpacePicker
          appearance="field"
          showMembership
          menuLabel="New chats land here"
          triggerLabel="Space"
          spaces={spaces}
          value={clock.spaceId}
          onSelect={(spaceId) => onChange({ spaceId })}
        />
      </div>
      <div className="grid gap-0.5">
        {preview ? <p className="text-sm">{preview}</p> : null}
        <p className="text-xs text-muted-foreground">{clock.timeZone}</p>
      </div>
    </>
  )
}

export function ScheduleDialog({
  open,
  onOpenChange,
  source,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: ScheduleDialogSource | null
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const workspace = useQuery(trpc.workspace.get.queryOptions({ draft: true }))
  const schedules = useQuery(trpc.workspace.listSchedules.queryOptions())
  const [form, setForm] = useState<ScheduleForm>(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const available = schedules.data?.available ?? true
  const spaces = workspace.data?.spaces ?? []
  const lastSource = useRef(source)
  if (source) lastSource.current = source
  const active = source ?? lastSource.current
  const openedKey = open && source ? sourceKey(source) : null
  const sourceRef = useRef(source)
  sourceRef.current = source

  useEffect(() => {
    const current = sourceRef.current
    if (!open || !current) return
    setForm(formForSource(current))
    setFormError(null)
  }, [open, openedKey])

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries(trpc.workspace.listSchedules.queryFilter()),
      queryClient.invalidateQueries(
        trpc.workspace.listChatTemplates.queryFilter()
      ),
    ])
  }

  const create = useMutation(
    trpc.workspace.createSchedule.mutationOptions({
      onSuccess: async () => {
        await refresh()
        toast.success("Schedule saved")
        onOpenChange(false)
      },
      onError: (error) => toast.error(error.message),
    })
  )
  const update = useMutation(
    trpc.workspace.updateSchedule.mutationOptions({
      onSuccess: async () => {
        await refresh()
        toast.success("Schedule updated")
        onOpenChange(false)
      },
      onError: (error) => toast.error(error.message),
    })
  )

  const pending = create.isPending || update.isPending
  const blocked =
    active?.kind === "template" && !active.leafIsUser
      ? "This template does not end on your message. Open the chat, end the branch on one, and save it again."
      : null
  const unavailable =
    active?.kind === "template" && schedules.isSuccess && !available

  function submit() {
    if (!active || blocked || unavailable) return
    const name = form.name.trim()
    const next = cadenceFromClock(form)
    if (!name) {
      setFormError("Name is required")
      return
    }
    if (!next) {
      setFormError("Enter a time")
      return
    }
    setFormError(null)
    if (active.kind === "template") {
      create.mutate({
        name,
        templateId: active.templateId,
        spaceId: form.spaceId,
        cadence: next,
      })
      return
    }
    update.mutate({
      id: active.schedule.id,
      name,
      spaceId: form.spaceId,
      cadence: next,
    })
  }

  const title = active?.kind === "edit" ? "Edit schedule" : "Schedule template"
  const description =
    active?.kind === "edit"
      ? "New chats from this schedule use this clock and space."
      : "Each run starts a new chat from this template and continues from your last message."

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(40rem,calc(100%-2rem))] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {blocked ? (
          <p className="text-sm text-muted-foreground">{blocked}</p>
        ) : unavailable ? (
          <p className="text-sm text-muted-foreground">
            This server is in stateless generation mode, so schedules stay
            stored and do not run.
          </p>
        ) : active ? (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="schedule-name">Name</Label>
              <Input
                id="schedule-name"
                value={form.name}
                maxLength={MAX_NAME}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </div>
            <ScheduleClockFields
              clock={form}
              spaces={spaces}
              onChange={(patch) =>
                setForm((current) => ({ ...current, ...patch }))
              }
            />
            {formError ? (
              <p className="text-sm text-destructive">{formError}</p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !form.name.trim()}>
                {active.kind === "edit" ? "Save" : "Schedule"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
        {blocked || unavailable ? (
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
