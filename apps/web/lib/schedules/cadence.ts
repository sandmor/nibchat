import dayjs from "dayjs"
import timezone from "dayjs/plugin/timezone"
import utc from "dayjs/plugin/utc"
import { z } from "zod"

dayjs.extend(utc)
dayjs.extend(timezone)

const hour = z.number().int().min(0).max(23)
const minute = z.number().int().min(0).max(59)

export const timeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: value })
      return true
    } catch {
      return false
    }
  }, "Unsupported time zone")

export const dailyCadenceSchema = z.object({
  kind: z.literal("daily"),
  hour,
  minute,
  timeZone: timeZoneSchema,
})

export const weeklyCadenceSchema = z.object({
  kind: z.literal("weekly"),
  /** 0 is Sunday, in `timeZone`. */
  weekdays: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .refine(
      (value) => new Set(value).size === value.length,
      "Duplicate weekday"
    ),
  hour,
  minute,
  timeZone: timeZoneSchema,
})

export const intervalCadenceSchema = z.object({
  kind: z.literal("interval"),
  everyHours: z.number().int().min(1).max(168),
  /** UTC instant the hour count is measured from. */
  anchor: z.string().datetime(),
  /** Zone passed into the generation, matching a message sent from that clock. */
  timeZone: timeZoneSchema,
})

export const onceCadenceSchema = z.object({
  kind: z.literal("once"),
  /** Exact UTC instant. */
  at: z.string().datetime(),
  /** Zone used to display the instant and passed to generation. */
  timeZone: timeZoneSchema,
})

export const cadenceSchema = z.discriminatedUnion("kind", [
  dailyCadenceSchema,
  weeklyCadenceSchema,
  intervalCadenceSchema,
  onceCadenceSchema,
])

export const cadenceInputSchema = z.discriminatedUnion("kind", [
  dailyCadenceSchema,
  weeklyCadenceSchema,
  intervalCadenceSchema.omit({ anchor: true }),
  onceCadenceSchema,
])

export type Cadence = z.infer<typeof cadenceSchema>
export type CadenceInput = z.infer<typeof cadenceInputSchema>

export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const

/**
 * First day of the week as `Date#getDay` (Sunday is 0). `Intl.Locale` numbers
 * Monday as 1 through Sunday as 7. Missing week info stays Sunday-first.
 */
function localeTag(locale?: string) {
  if (locale) return locale
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en-US"
  } catch {
    return "en-US"
  }
}

function weekStartsOn(locale?: string) {
  try {
    const localeObject = new Intl.Locale(localeTag(locale)) as Intl.Locale & {
      getWeekInfo?: () => { firstDay?: number }
      weekInfo?: { firstDay?: number }
    }
    const firstDay =
      localeObject.getWeekInfo?.().firstDay ?? localeObject.weekInfo?.firstDay
    if (firstDay === 7) return 0
    if (typeof firstDay === "number" && firstDay >= 1 && firstDay <= 6)
      return firstDay
  } catch {
    return 0
  }
  return 0
}

/** Weekday numbers beginning on the locale's first day. */
export function weekdayOrder(locale?: string) {
  const start = weekStartsOn(locale)
  return Array.from({ length: 7 }, (_, index) => (start + index) % 7)
}

function sameWeekdays(days: readonly number[], expected: readonly number[]) {
  if (days.length !== expected.length) return false
  const present = new Set(days)
  return expected.every((day) => present.has(day))
}

export function parseCadence(value: string | unknown): Cadence {
  return cadenceSchema.parse(
    typeof value === "string" ? JSON.parse(value) : value
  )
}

export function cadenceToJson(cadence: Cadence) {
  return JSON.stringify(cadenceSchema.parse(cadence))
}

/** Store an interval anchor when the client did not send one. */
export function storeCadence(input: CadenceInput, anchor: Date): Cadence {
  const parsed = cadenceInputSchema.parse(input)
  if (parsed.kind === "interval")
    return {
      kind: "interval",
      everyHours: parsed.everyHours,
      timeZone: parsed.timeZone,
      anchor: anchor.toISOString(),
    }
  return parsed
}

const WALL_FORMAT = "YYYY-MM-DD HH:mm"

function pad(value: number) {
  return String(value).padStart(2, "0")
}

/** Wall-clock time in `timeZone`. A spring-forward gap moves to the next real minute. */
function wallInstant(
  date: string,
  hourOfDay: number,
  minuteOfHour: number,
  timeZone: string
) {
  const wanted = `${date} ${pad(hourOfDay)}:${pad(minuteOfHour)}`
  const parsed = dayjs.tz(wanted, WALL_FORMAT, timeZone)
  if (parsed.tz(timeZone).format(WALL_FORMAT) === wanted) return parsed.toDate()
  const start = hourOfDay * 60 + minuteOfHour
  for (let extra = 1; extra <= 180; extra++) {
    const total = start + extra
    const nextHour = Math.floor(total / 60)
    const nextMinute = total % 60
    if (nextHour > 23) break
    const candidate = `${date} ${pad(nextHour)}:${pad(nextMinute)}`
    const attempt = dayjs.tz(candidate, WALL_FORMAT, timeZone)
    if (attempt.tz(timeZone).format(WALL_FORMAT) === candidate)
      return attempt.toDate()
  }
  return parsed.toDate()
}

export function wallTimeInstant(
  date: string,
  hourOfDay: number,
  minuteOfHour: number,
  timeZone: string
) {
  return wallInstant(date, hourOfDay, minuteOfHour, timeZone)
}

/**
 * Next slot strictly after `after`. Daily and weekly clocks are wall time in
 * the cadence time zone. Missed occurrences collapse to that single future slot.
 */
export function followingRunAt(cadence: Cadence, after: Date) {
  if (cadence.kind === "once") {
    const instant = new Date(cadence.at)
    if (instant.getTime() <= after.getTime())
      throw new Error("The scheduled time must be in the future")
    return instant
  }
  if (cadence.kind === "interval") {
    const anchor = new Date(cadence.anchor)
    const step = cadence.everyHours * 60 * 60 * 1000
    if (anchor.getTime() > after.getTime()) return anchor
    const elapsed = after.getTime() - anchor.getTime()
    const steps = Math.floor(elapsed / step) + 1
    return new Date(anchor.getTime() + steps * step)
  }
  const start = dayjs(after).tz(cadence.timeZone).startOf("day")
  for (let offset = 0; offset < 8; offset++) {
    const day = start.add(offset, "day")
    if (cadence.kind === "weekly" && !cadence.weekdays.includes(day.day()))
      continue
    const instant = wallInstant(
      day.format("YYYY-MM-DD"),
      cadence.hour,
      cadence.minute,
      cadence.timeZone
    )
    if (instant.getTime() > after.getTime()) return instant
  }
  throw new Error("No upcoming run")
}

function formatClock(hourOfDay: number, minuteOfHour: number, locale?: string) {
  const probe = new Date(Date.UTC(2026, 0, 1, hourOfDay, minuteOfHour))
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(probe)
}

export function formatCadence(cadence: Cadence, locale?: string) {
  if (cadence.kind === "once")
    return `Once on ${formatRunInstant(cadence.at, cadence.timeZone, locale)}`
  if (cadence.kind === "interval") {
    const hours = cadence.everyHours
    return `Every ${hours} hour${hours === 1 ? "" : "s"}`
  }
  const clock = formatClock(cadence.hour, cadence.minute, locale)
  if (cadence.kind === "daily") return `Every day at ${clock}`
  if (sameWeekdays(cadence.weekdays, [0, 1, 2, 3, 4, 5, 6]))
    return `Every day at ${clock}`
  if (sameWeekdays(cadence.weekdays, [1, 2, 3, 4, 5]))
    return `Weekdays at ${clock}`
  if (sameWeekdays(cadence.weekdays, [0, 6])) return `Weekends at ${clock}`
  const order = weekdayOrder(locale)
  const days = [...cadence.weekdays]
    .sort((left, right) => order.indexOf(left) - order.indexOf(right))
    .map((day) => WEEKDAY_LABELS[day]!.slice(0, 3))
    .join(", ")
  return `${days} at ${clock}`
}

export function formatRunInstant(
  iso: string,
  timeZone: string,
  locale?: string
) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso))
}
