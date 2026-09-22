"use client"

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { UnfoldMoreIcon } from "@hugeicons/core-free-icons"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import {
  applyBoundedDigit,
  dayPeriodLabel,
  formatClockLabel,
  formatClockTime,
  hour12Parts,
  hour24From12,
  minuteOptions,
  parseClockTime,
  usesHour12,
} from "@/components/ui/time-value"

const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const HOURS_24 = Array.from({ length: 24 }, (_, hour) => hour)

type ColumnId = "hour" | "minute" | "period"

function subscribeHourCycle() {
  return () => {}
}

function scrollInsideParent(node: HTMLElement | null) {
  const parent = node?.parentElement
  if (!node || !parent) return
  const top = node.offsetTop
  const bottom = top + node.offsetHeight
  if (top < parent.scrollTop) parent.scrollTop = top
  else if (bottom > parent.scrollTop + parent.clientHeight)
    parent.scrollTop = bottom - parent.clientHeight
}

function optionClass(selected: boolean) {
  return cn(
    "flex h-8 w-full items-center justify-center rounded-xl text-sm outline-none",
    "hover:bg-accent/60 hover:text-accent-foreground",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
    selected && "bg-accent text-accent-foreground"
  )
}

export function TimeField({
  id = "time",
  value,
  onChange,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
}) {
  const hour12 = useSyncExternalStore(
    subscribeHourCycle,
    usesHour12,
    () => false
  )
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<ColumnId>("hour")
  const parsed = parseClockTime(value) ?? { hour: 9, minute: 0 }
  const parts = hour12Parts(parsed.hour)
  const label = formatClockLabel(value)
  const digitBuffer = useRef("")
  const digitTimer = useRef<number | null>(null)
  const hourRef = useRef<HTMLButtonElement>(null)
  const minuteRef = useRef<HTMLButtonElement>(null)
  const periodRef = useRef<HTMLButtonElement>(null)

  useEffect(
    () => () => {
      if (digitTimer.current != null) window.clearTimeout(digitTimer.current)
    },
    []
  )

  useEffect(() => {
    if (!open) return
    const node =
      active === "minute"
        ? minuteRef.current
        : active === "period"
          ? periodRef.current
          : hourRef.current
    node?.focus({ preventScroll: true })
    scrollInsideParent(node)
  }, [open, active, value])

  function commit(hour: number, minute: number) {
    onChange(formatClockTime(hour, minute))
  }

  function rememberDigit(buffer: string) {
    digitBuffer.current = buffer
    if (digitTimer.current != null) window.clearTimeout(digitTimer.current)
    digitTimer.current = window.setTimeout(() => {
      digitBuffer.current = ""
    }, 1000)
  }

  function step(column: "hour" | "minute", delta: number) {
    digitBuffer.current = ""
    if (column === "hour") {
      const list = hour12 ? HOURS_12 : HOURS_24
      const current = hour12 ? parts.hour : parsed.hour
      const index = Math.max(0, list.indexOf(current))
      const next = list[(index + delta + list.length) % list.length] ?? current
      commit(hour12 ? hour24From12(next, parts.period) : next, parsed.minute)
      return
    }
    const list = minuteOptions(parsed.minute)
    const index = Math.max(0, list.indexOf(parsed.minute))
    const next =
      list[(index + delta + list.length) % list.length] ?? parsed.minute
    commit(parsed.hour, next)
  }

  function typeDigit(column: "hour" | "minute", digit: string) {
    if (column === "minute") {
      const next = applyBoundedDigit(digitBuffer.current, digit, 59)
      rememberDigit(next.buffer)
      commit(parsed.hour, next.value)
      return
    }
    const next = applyBoundedDigit(digitBuffer.current, digit, hour12 ? 12 : 23)
    if (hour12 && next.value < 1) {
      digitBuffer.current = ""
      return
    }
    rememberDigit(next.buffer)
    commit(
      hour12 ? hour24From12(next.value, parts.period) : next.value,
      parsed.minute
    )
  }

  function onPanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const column = (event.target as HTMLElement).dataset.column as
      | ColumnId
      | undefined
    if (!column) return
    if (event.key === "Enter") {
      event.preventDefault()
      setOpen(false)
      return
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault()
      const order: ColumnId[] = hour12
        ? ["hour", "minute", "period"]
        : ["hour", "minute"]
      const index = order.indexOf(column)
      const delta = event.key === "ArrowRight" ? 1 : -1
      const next = order[(index + delta + order.length) % order.length]
      if (next) {
        digitBuffer.current = ""
        setActive(next)
      }
      return
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const delta = event.key === "ArrowDown" ? 1 : -1
      if (column === "period") {
        commit(
          hour24From12(parts.hour, parts.period === "AM" ? "PM" : "AM"),
          parsed.minute
        )
        return
      }
      step(column, delta)
      return
    }
    if (
      (column === "hour" || column === "minute") &&
      /^\d$/.test(event.key) &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault()
      typeDigit(column, event.key)
    }
  }

  const hours = hour12 ? HOURS_12 : HOURS_24
  const hourValue = hour12 ? parts.hour : parsed.hour
  const minutes = minuteOptions(parsed.minute)

  return (
    <div className="grid gap-1.5">
      <Label id={`${id}-label`} htmlFor={id}>
        Time
      </Label>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) setActive("hour")
        }}
      >
        <PopoverTrigger
          type="button"
          id={id}
          aria-labelledby={`${id}-label ${id}-value`}
          data-theme-group="input"
          data-theme-target="input"
          className="flex h-9 w-full items-center justify-between gap-1.5 rounded-4xl border border-input-border bg-input/30 px-3 text-sm transition-colors outline-none hover:bg-input/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 elevation-dark:bg-input elevation-dark:hover:bg-input"
        >
          <span id={`${id}-value`}>{label}</span>
          <HugeiconsIcon
            icon={UnfoldMoreIcon}
            strokeWidth={2}
            className="size-4 text-muted-foreground"
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label="Time"
          className="w-auto gap-0 p-1"
          onKeyDown={onPanelKeyDown}
        >
          {hour12 ? (
            <div
              role="group"
              aria-label="AM or PM"
              className="grid grid-cols-2 gap-1 border-b border-border/60 p-1"
            >
              {(["AM", "PM"] as const).map((period) => {
                const selected = parts.period === period
                return (
                  <button
                    key={period}
                    type="button"
                    data-column="period"
                    ref={selected ? periodRef : undefined}
                    tabIndex={active === "period" && selected ? 0 : -1}
                    aria-pressed={selected}
                    className={optionClass(selected)}
                    onClick={() => {
                      setActive("period")
                      commit(hour24From12(parts.hour, period), parsed.minute)
                    }}
                  >
                    {dayPeriodLabel(period)}
                  </button>
                )
              })}
            </div>
          ) : null}
          <div className="flex">
            <div
              role="listbox"
              aria-label="Hour"
              className="relative max-h-56 w-16 overflow-y-auto overscroll-contain p-1"
            >
              {hours.map((hour) => {
                const selected = hour === hourValue
                return (
                  <button
                    key={hour}
                    type="button"
                    role="option"
                    data-column="hour"
                    aria-selected={selected}
                    ref={selected ? hourRef : undefined}
                    tabIndex={active === "hour" && selected ? 0 : -1}
                    className={optionClass(selected)}
                    onClick={() => {
                      setActive("hour")
                      digitBuffer.current = ""
                      commit(
                        hour12 ? hour24From12(hour, parts.period) : hour,
                        parsed.minute
                      )
                    }}
                  >
                    {hour12 ? hour : String(hour).padStart(2, "0")}
                  </button>
                )
              })}
            </div>
            <div
              role="listbox"
              aria-label="Minute"
              className="relative max-h-56 w-16 overflow-y-auto overscroll-contain border-l border-border/60 p-1"
            >
              {minutes.map((minute) => {
                const selected = minute === parsed.minute
                return (
                  <button
                    key={minute}
                    type="button"
                    role="option"
                    data-column="minute"
                    aria-selected={selected}
                    ref={selected ? minuteRef : undefined}
                    tabIndex={active === "minute" && selected ? 0 : -1}
                    className={optionClass(selected)}
                    onClick={() => {
                      setActive("minute")
                      digitBuffer.current = ""
                      commit(parsed.hour, minute)
                    }}
                  >
                    {String(minute).padStart(2, "0")}
                  </button>
                )
              })}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
