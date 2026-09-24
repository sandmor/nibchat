"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
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
import { DateField } from "@/components/ui/date-field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MAX_COLLECTION, MAX_NAME, generationCountInRange } from "@/lib/limits"
import { GenerationCountField } from "./generation-count"
import {
  WEEKDAY_LABELS,
  followingRunAt,
  formatRunInstant,
  storeCadence,
  wallTimeInstant,
  weekdayOrder,
  type Cadence,
  type CadenceInput,
} from "@/lib/schedules/cadence"
import type { SpaceRow } from "@/lib/types"
import { useTRPC } from "@/lib/trpc-react"
import { SpacePicker } from "./space-picker"

type CadenceKind = Cadence["kind"]

const SUNDAY_FIRST_WEEK = [0, 1, 2, 3, 4, 5, 6]

let cachedWeekdays: readonly number[] | null = null

function browserWeekdays() {
  cachedWeekdays ??= weekdayOrder()
  return cachedWeekdays
}

export type ScheduleDialogSchedule = {
  id: string
  name: string
  spaceId: string | null
  cadence: Cadence
  replyCount: number
  actionKind?: "template" | "chat_generate"
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
  weekdays: number[]
  date: string
  everyHours: number
  timeZone: string
}

type ScheduleForm = ScheduleClock & {
  name: string
  replyCount: number
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

function onceFields(at: string, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(at))
      .map((part) => [part.type, part.value])
  )
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  }
}

function clockFromCadence(cadence: Cadence) {
  if (cadence.kind === "interval") return "09:00"
  if (cadence.kind === "once")
    return onceFields(cadence.at, cadence.timeZone).time
  return `${pad(cadence.hour)}:${pad(cadence.minute)}`
}

function tomorrowDate() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function onceScheduleClock(at: string, timeZone: string): ScheduleClock {
  const fields = onceFields(at, timeZone)
  return {
    ...defaultScheduleClock(),
    kind: "once",
    date: fields.date,
    time: fields.time,
    timeZone,
  }
}

export function defaultScheduleClock(
  spaceId: string | null = null
): ScheduleClock {
  return {
    spaceId,
    kind: "daily",
    time: "09:00",
    weekdays: [new Date().getDay()],
    date: tomorrowDate(),
    everyHours: 24,
    timeZone: browserTimeZone(),
  }
}

function emptyForm(partial: Partial<ScheduleForm> = {}): ScheduleForm {
  return {
    name: "",
    replyCount: 1,
    ...defaultScheduleClock(),
    ...partial,
  }
}

export function formForSource(source: ScheduleDialogSource): ScheduleForm {
  if (source.kind === "edit") {
    const cadence = source.schedule.cadence
    return emptyForm({
      name: source.schedule.name,
      replyCount: source.schedule.replyCount,
      spaceId: source.schedule.spaceId,
      kind: cadence.kind,
      time: clockFromCadence(cadence),
      weekdays:
        cadence.kind === "weekly" ? cadence.weekdays : [new Date().getDay()],
      date:
        cadence.kind === "once"
          ? onceFields(cadence.at, cadence.timeZone).date
          : tomorrowDate(),
      everyHours: cadence.kind === "interval" ? cadence.everyHours : 24,
      timeZone: cadence.timeZone,
    })
  }
  return emptyForm({ name: source.templateName })
}

export function cadenceFromClock(clock: ScheduleClock): CadenceInput | null {
  if (clock.kind === "once") {
    const [hourText, minuteText] = clock.time.split(":")
    const hour = Number(hourText)
    const minute = Number(minuteText)
    if (!clock.date || !Number.isInteger(hour) || !Number.isInteger(minute))
      return null
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
    const at = wallTimeInstant(clock.date, hour, minute, clock.timeZone)
    return { kind: "once", at: at.toISOString(), timeZone: clock.timeZone }
  }
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
  if (clock.kind === "weekly") {
    if (clock.weekdays.length === 0) return null
    return {
      kind: "weekly",
      weekdays: clock.weekdays,
      hour,
      minute,
      timeZone: clock.timeZone,
    }
  }
  return { kind: "daily", hour, minute, timeZone: clock.timeZone }
}

export function scheduleClockError(clock: ScheduleClock): string | null {
  if (clock.kind === "weekly" && clock.weekdays.length === 0)
    return "Pick at least one day"
  const cadence = cadenceFromClock(clock)
  if (!cadence) return "Enter a time"
  try {
    followingRunAt(storeCadence(cadence, new Date()), new Date())
    return null
  } catch {
    return "Choose a future time"
  }
}

function sourceKey(source: ScheduleDialogSource) {
  if (source.kind === "edit") return `edit:${source.schedule.id}`
  return `template:${source.templateId}`
}

export function ScheduleClockFields({
  clock,
  spaces,
  onChange,
  onceOnly = false,
  showSpace = true,
}: {
  clock: ScheduleClock
  spaces: SpaceRow[]
  onChange: (patch: Partial<ScheduleClock>) => void
  onceOnly?: boolean
  showSpace?: boolean
}) {
  const cadence = cadenceFromClock(clock)
  let error = scheduleClockError(clock)
  let preview: string | null = null
  if (cadence && !error) {
    try {
      preview = `${cadence.kind === "once" ? "" : "Next "}${formatRunInstant(followingRunAt(storeCadence(cadence, new Date()), new Date()).toISOString(), clock.timeZone)}`
    } catch {
      error = "Choose a future time"
    }
  }
  const kindItems = {
    once: "Once",
    daily: "Daily",
    weekly: "Weekly",
    interval: "Every few hours",
  }
  const weekdayButtons = useSyncExternalStore(
    () => () => {},
    browserWeekdays,
    () => SUNDAY_FIRST_WEEK
  )
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {!onceOnly ? (
          <div
            className={
              clock.kind === "daily" || clock.kind === "once"
                ? "grid gap-1.5 sm:col-span-2"
                : "grid gap-1.5"
            }
          >
            <Label htmlFor="schedule-kind">When</Label>
            <Select
              value={clock.kind}
              items={kindItems}
              onValueChange={(kind) => {
                if (
                  kind === "once" ||
                  kind === "daily" ||
                  kind === "weekly" ||
                  kind === "interval"
                )
                  onChange({ kind })
              }}
            >
              <SelectTrigger id="schedule-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="once">Once</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="interval">Every few hours</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {clock.kind === "weekly" ? (
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Days</Label>
            <div className="flex flex-wrap gap-1">
              {weekdayButtons.map((weekday) => {
                const label = WEEKDAY_LABELS[weekday] ?? "Day"
                const selected = clock.weekdays.includes(weekday)
                return (
                  <Button
                    key={label}
                    type="button"
                    size="sm"
                    variant={selected ? "default" : "outline"}
                    aria-pressed={selected}
                    aria-label={label}
                    onClick={() =>
                      onChange({
                        weekdays: selected
                          ? clock.weekdays.filter((day) => day !== weekday)
                          : [...clock.weekdays, weekday].sort(),
                      })
                    }
                  >
                    {label.slice(0, 3)}
                  </Button>
                )
              })}
            </div>
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onChange({ weekdays: [1, 2, 3, 4, 5] })}
              >
                Weekdays
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onChange({ weekdays: [0, 6] })}
              >
                Weekends
              </Button>
            </div>
          </div>
        ) : null}
        {clock.kind === "once" ? (
          <>
            <DateField
              id="schedule-date"
              value={clock.date}
              onChange={(date) => onChange({ date })}
            />
            <div>
              <TimeField
                id="schedule-time"
                value={clock.time}
                onChange={(time) => onChange({ time })}
              />
            </div>
          </>
        ) : clock.kind === "interval" ? (
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
      {showSpace ? (
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
      ) : null}
      <div className="grid gap-0.5">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : preview ? (
          <p className="text-sm">{preview}</p>
        ) : null}
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
    if (!generationCountInRange(form.replyCount)) {
      setFormError(
        `Choose 1 to ${MAX_COLLECTION} replies`
      )
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
        replyCount: form.replyCount,
      })
      return
    }
    update.mutate({
      id: active.schedule.id,
      name,
      spaceId: form.spaceId,
      cadence: next,
      replyCount: form.replyCount,
    })
  }

  const title = active?.kind === "edit" ? "Edit schedule" : "Schedule template"
  const editingChat =
    active?.kind === "edit" &&
    active.schedule.actionKind !== undefined &&
    active.schedule.actionKind !== "template"
  const description = editingChat
    ? "This reply runs once in the existing chat."
    : active?.kind === "edit"
      ? "New chats from this schedule use this clock and space."
      : "Each run starts a new chat from this template using your current defaults and the selected space."
  const clockError = scheduleClockError(form)

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
              onceOnly={
                active.kind === "edit" &&
                active.schedule.actionKind !== undefined &&
                active.schedule.actionKind !== "template"
              }
              showSpace={
                active.kind !== "edit" ||
                !active.schedule.actionKind ||
                active.schedule.actionKind === "template"
              }
              onChange={(patch) =>
                setForm((current) => ({ ...current, ...patch }))
              }
            />
            <GenerationCountField
              id="schedule-reply-count"
              value={form.replyCount}
              onChange={(replyCount) =>
                setForm((current) => ({ ...current, replyCount }))
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
              <Button
                type="submit"
                disabled={
                  pending ||
                  !form.name.trim() ||
                  Boolean(clockError) ||
                  !generationCountInRange(form.replyCount)
                }
              >
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
