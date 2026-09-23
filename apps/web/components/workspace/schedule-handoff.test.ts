import { describe, expect, it } from "vitest"
import {
  reconcileScheduleDepartures,
  scheduleDepartures,
  type ScheduleSnapshot,
} from "./schedule-handoff"

const rect = { x: 10, y: 20, width: 400, height: 76 }

function schedule(id: string, parentId = "user"): ScheduleSnapshot {
  return {
    id,
    parentId,
    nextRunAt: "2099-01-01T12:00:00.000Z",
    timeZone: "UTC",
    rect,
  }
}

describe("scheduleDepartures", () => {
  it("pairs a removed schedule with the new assistant under its parent", () => {
    expect(
      scheduleDepartures({
        previous: [schedule("job")],
        pendingIds: new Set(),
        previousAssistants: [],
        assistants: [{ id: "reply", parentId: "user" }],
        activeScheduleIds: new Set(),
      })
    ).toEqual([
      {
        scheduleId: "job",
        parentId: "user",
        fromRect: rect,
        nextRunAt: "2099-01-01T12:00:00.000Z",
        timeZone: "UTC",
        nodeId: "reply",
      },
    ])
  })

  it("fades a schedule that leaves without a new reply", () => {
    const [departure] = scheduleDepartures({
      previous: [schedule("job")],
      pendingIds: new Set(),
      previousAssistants: [{ id: "older", parentId: "user" }],
      assistants: [{ id: "older", parentId: "user" }],
      activeScheduleIds: new Set(),
    })
    expect(departure?.nodeId).toBeNull()
  })

  it("does not pair a reply that appeared under a different parent", () => {
    const [departure] = scheduleDepartures({
      previous: [schedule("job", "user")],
      pendingIds: new Set(),
      previousAssistants: [],
      assistants: [{ id: "reply", parentId: "other" }],
      activeScheduleIds: new Set(),
    })
    expect(departure?.nodeId).toBeNull()
  })

  it("keeps a still-pending schedule and an in-flight departure", () => {
    expect(
      scheduleDepartures({
        previous: [schedule("stay"), schedule("gone")],
        pendingIds: new Set(["stay"]),
        previousAssistants: [],
        assistants: [],
        activeScheduleIds: new Set(["gone"]),
      })
    ).toEqual([])
  })

  it("gives one new reply to one of several removed schedules", () => {
    const departures = scheduleDepartures({
      previous: [schedule("b"), schedule("a")],
      pendingIds: new Set(),
      previousAssistants: [],
      assistants: [{ id: "reply", parentId: "user" }],
      activeScheduleIds: new Set(),
    })
    expect(departures.map((item) => [item.scheduleId, item.nodeId])).toEqual([
      ["a", "reply"],
      ["b", null],
    ])
  })
})

describe("reconcileScheduleDepartures", () => {
  it("promotes a fade when the reply shows up on a later refresh", () => {
    const faded = scheduleDepartures({
      previous: [schedule("job")],
      pendingIds: new Set(),
      previousAssistants: [],
      assistants: [],
      activeScheduleIds: new Set(),
    })
    const next = reconcileScheduleDepartures({
      current: faded,
      previous: [],
      pendingIds: new Set(),
      previousAssistants: [],
      assistants: [{ id: "reply", parentId: "user" }],
    })
    expect(next).toEqual([{ ...faded[0], nodeId: "reply" }])
  })
})
