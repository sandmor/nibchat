import { describe, expect, it } from "vitest"
import {
  followingRunAt,
  parseCadence,
  type Cadence,
} from "@/lib/schedules/cadence"

const daily = parseCadence({
  kind: "daily",
  hour: 9,
  minute: 0,
  timeZone: "UTC",
})
const weekly = parseCadence({
  kind: "weekly",
  weekdays: [1],
  hour: 9,
  minute: 0,
  timeZone: "UTC",
})
const interval = parseCadence({
  kind: "interval",
  everyHours: 6,
  anchor: "2026-09-21T00:00:00.000Z",
  timeZone: "UTC",
})

function at(iso: string, cadence: Cadence = daily) {
  return followingRunAt(cadence, new Date(iso)).toISOString()
}

describe("followingRunAt", () => {
  it("uses the same UTC day when the clock time is still ahead", () => {
    expect(at("2026-09-21T08:30:00.000Z")).toBe("2026-09-21T09:00:00.000Z")
  })

  it("moves to the next day when the minute has started", () => {
    expect(at("2026-09-21T09:00:00.000Z")).toBe("2026-09-22T09:00:00.000Z")
    expect(at("2026-09-21T09:00:01.000Z")).toBe("2026-09-22T09:00:00.000Z")
  })

  it("skips missed days and returns the next future slot", () => {
    expect(at("2026-09-23T10:00:00.000Z")).toBe("2026-09-24T09:00:00.000Z")
  })

  it("lands on the requested UTC weekday", () => {
    expect(at("2026-09-20T10:00:00.000Z", weekly)).toBe(
      "2026-09-21T09:00:00.000Z"
    )
    expect(at("2026-09-21T09:30:00.000Z", weekly)).toBe(
      "2026-09-28T09:00:00.000Z"
    )
  })

  it("runs on any selected weekday", () => {
    const workdays = parseCadence({
      kind: "weekly",
      weekdays: [1, 3, 5],
      hour: 9,
      minute: 0,
      timeZone: "UTC",
    })
    expect(at("2026-09-21T10:00:00.000Z", workdays)).toBe(
      "2026-09-23T09:00:00.000Z"
    )
  })

  it("returns a future one-time instant and rejects an elapsed one", () => {
    const once = parseCadence({
      kind: "once",
      at: "2026-09-22T12:00:00.000Z",
      timeZone: "UTC",
    })
    expect(at("2026-09-22T11:00:00.000Z", once)).toBe(
      "2026-09-22T12:00:00.000Z"
    )
    expect(() => at("2026-09-22T12:00:00.000Z", once)).toThrow(/future/)
  })

  it("steps an interval from its anchor", () => {
    expect(at("2026-09-21T01:00:00.000Z", interval)).toBe(
      "2026-09-21T06:00:00.000Z"
    )
    expect(at("2026-09-21T06:00:00.000Z", interval)).toBe(
      "2026-09-21T12:00:00.000Z"
    )
  })

  it("keeps a local clock across daylight saving", () => {
    const chicago = parseCadence({
      kind: "daily",
      hour: 9,
      minute: 0,
      timeZone: "America/Chicago",
    })
    expect(at("2026-01-15T14:00:00.000Z", chicago)).toBe(
      "2026-01-15T15:00:00.000Z"
    )
    expect(at("2026-09-21T13:00:00.000Z", chicago)).toBe(
      "2026-09-21T14:00:00.000Z"
    )
    expect(at("2026-03-07T15:00:00.000Z", chicago)).toBe(
      "2026-03-08T14:00:00.000Z"
    )
  })

  it("moves a spring-forward gap to the next real minute", () => {
    const gap = parseCadence({
      kind: "daily",
      hour: 2,
      minute: 30,
      timeZone: "America/Chicago",
    })
    expect(at("2026-03-08T07:00:00.000Z", gap)).toBe("2026-03-08T08:00:00.000Z")
  })

  it("uses the weekday in the schedule time zone", () => {
    const monday = parseCadence({
      kind: "weekly",
      weekdays: [1],
      hour: 9,
      minute: 0,
      timeZone: "America/Chicago",
    })
    expect(at("2026-09-20T18:00:00.000Z", monday)).toBe(
      "2026-09-21T14:00:00.000Z"
    )
    expect(at("2026-09-21T14:00:00.000Z", monday)).toBe(
      "2026-09-28T14:00:00.000Z"
    )
  })
})
