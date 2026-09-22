const MINUTE_STEPS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]

export function usesHour12(locale?: string) {
  try {
    const cycle = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
    }).resolvedOptions().hourCycle
    return cycle === "h11" || cycle === "h12"
  } catch {
    return false
  }
}

export function parseClockTime(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

export function formatClockTime(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

export function hour12Parts(hour24: number) {
  return {
    hour: hour24 % 12 || 12,
    period: hour24 >= 12 ? ("PM" as const) : ("AM" as const),
  }
}

export function hour24From12(hour: number, period: "AM" | "PM") {
  const normalized = hour % 12
  return period === "PM" ? normalized + 12 : normalized
}

export function minuteOptions(minute: number) {
  const values = new Set(MINUTE_STEPS)
  if (minute >= 0 && minute <= 59) values.add(minute)
  return [...values].sort((left, right) => left - right)
}

/** Two quick digits set a number up to `max`. A value past the max starts over. */
export function applyBoundedDigit(buffer: string, digit: string, max: number) {
  const combined = `${buffer}${digit}`.slice(-2)
  const next = Number(combined)
  if (!Number.isInteger(next) || next > max) {
    const single = Number(digit)
    if (single > max) return { value: 0, buffer: "" }
    return { value: single, buffer: digit }
  }
  return { value: next, buffer: String(next) }
}

export function formatClockLabel(value: string, locale?: string) {
  const parsed = parseClockTime(value)
  if (!parsed) return value
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2020, 0, 1, parsed.hour, parsed.minute))
}

export function dayPeriodLabel(period: "AM" | "PM", locale?: string) {
  const hour = period === "AM" ? 1 : 13
  try {
    const label = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      hourCycle: "h12",
    })
      .formatToParts(new Date(2020, 0, 1, hour))
      .find((part) => part.type === "dayPeriod")?.value
    return label || period
  } catch {
    return period
  }
}
