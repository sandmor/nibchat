import { describe, expect, it } from "vitest"
import {
  alignedTranscriptOffset,
  unobservedTranscriptScroll,
  readingTranscriptOffset,
  transcriptAtEnd,
  transcriptNavigationOffset,
  type TranscriptGeometry,
} from "./transcript-viewport-model"

describe("one-time stepper alignment", () => {
  it("compensates the replacement's height without changing viewport Y", () => {
    expect(alignedTranscriptOffset(1150, 200, 5000)).toBe(950)
    expect(alignedTranscriptOffset(1300, 200, 5000)).toBe(1100)
  })

  it("clamps at both boundaries without extending the transcript", () => {
    expect(alignedTranscriptOffset(100, 400, 900)).toBe(0)
    expect(alignedTranscriptOffset(1150, 200, 900)).toBe(900)
    expect(alignedTranscriptOffset(100, 50, -200)).toBe(0)
  })
})

describe("reading preservation", () => {
  const previous: TranscriptGeometry[] = [
    { key: "slot:0", start: 0, size: 400 },
    { key: "slot:1", start: 400, size: 600 },
    { key: "slot:2", start: 1000, size: 500 },
  ]
  const anchor = { key: "slot:1", offsetWithinRow: 80 }
  const resolve = (next: TranscriptGeometry[], maxScroll = 5000) =>
    readingTranscriptOffset({
      anchor,
      previous,
      next,
      previousScrollTop: 480,
      maxScroll,
    })

  it("preserves the row point when content above it grows", () => {
    expect(
      resolve([
        { key: "slot:0", start: 0, size: 550 },
        { key: "slot:1", start: 550, size: 600 },
      ])
    ).toBe(630)
  })

  it("does not follow growth below the reading point or a newly sent message", () => {
    expect(
      resolve([
        previous[0]!,
        { ...previous[1]!, size: 1200 },
        { key: "slot:2", start: 1600, size: 500 },
        { key: "slot:3", start: 2100, size: 300 },
      ])
    ).toBe(480)
  })

  it("preserves a surviving predecessor's viewport position after removal", () => {
    expect(resolve([{ key: "slot:0", start: 200, size: 400 }])).toBe(680)
  })

  it("uses a surviving successor when no predecessor remains", () => {
    expect(resolve([{ key: "slot:2", start: 700, size: 500 }])).toBe(180)
  })

  it("clamps when the branch shortens or every anchor disappears", () => {
    expect(resolve(previous, 300)).toBe(300)
    expect(resolve([], 200)).toBe(200)
  })
})

describe("explicit navigation", () => {
  const input = {
    top: 1000,
    bottom: 1300,
    scrollTop: 800,
    viewportHeight: 600,
    maxScroll: 2000,
  }
  it("leaves already visible targets in place", () => {
    expect(transcriptNavigationOffset({ ...input, align: "nearest" })).toBe(800)
  })
  it("aligns the requested edge and clamps to the available range", () => {
    expect(transcriptNavigationOffset({ ...input, align: "start" })).toBe(1000)
    expect(transcriptNavigationOffset({ ...input, align: "end" })).toBe(700)
    expect(
      transcriptNavigationOffset({ ...input, align: "start", maxScroll: 900 })
    ).toBe(900)
  })
  it("reveals a target below the viewport with the smallest movement", () => {
    expect(
      transcriptNavigationOffset({ ...input, bottom: 1700, align: "nearest" })
    ).toBe(1100)
  })
})

describe("end-follow eligibility", () => {
  it("uses the natural scroll range and the shared live-edge threshold", () => {
    expect(transcriptAtEnd(936, 1000)).toBe(true)
    expect(transcriptAtEnd(935, 1000)).toBe(false)
    expect(transcriptAtEnd(0, 0)).toBe(true)
  })
})

describe("native scrolling before its event", () => {
  it("recognizes reader movement before a replacement commit", () => {
    expect(unobservedTranscriptScroll(800, 700, 2000)).toBe(-100)
    expect(unobservedTranscriptScroll(800, 1000, 2000)).toBe(200)
  })
  it("does not treat a shortened scroll range as reader movement", () => {
    expect(unobservedTranscriptScroll(800, 500, 500)).toBe(0)
    expect(unobservedTranscriptScroll(800, 0, 0)).toBe(0)
  })
})

// These tests drive the public contract, including acknowledgements from a
// simulated browser. Geometry-only tests above cannot expose event-order bugs.
import {
  createTranscriptViewport,
  transitionTranscriptViewport,
  transcriptViewportHandoff,
  type TranscriptLayout,
  type TranscriptViewportCommand,
  type TranscriptViewportEvent,
} from "./transcript-viewport-model"

const layoutFixture = (): TranscriptLayout => ({
  viewportHeight: 300,
  totalSize: 1500,
  paddingStart: 40,
  rows: [
    {
      key: "slot:0",
      messageId: "a",
      start: 0,
      size: 400,
      measured: true,
      stepperOffset: 350,
    },
    {
      key: "slot:1",
      messageId: "b",
      start: 400,
      size: 600,
      measured: true,
      stepperOffset: 550,
    },
    {
      key: "slot:2",
      messageId: "c",
      start: 1000,
      size: 500,
      measured: true,
      stepperOffset: 450,
    },
  ],
})
function machine(initial = createTranscriptViewport()) {
  let state = initial
  const send = (event: TranscriptViewportEvent) => {
    const previous = structuredClone(state)
    const input = structuredClone(event)
    const result = transitionTranscriptViewport(state, event)
    expect(state).toEqual(previous)
    expect(event).toEqual(input)
    state = result.state
    return result.commands
  }
  const acknowledge = (commands: TranscriptViewportCommand[]) => {
    for (const command of commands) {
      if (command.type !== "scroll") continue
      const mode = state.mode
      send({ type: "applied", id: command.id, offset: command.offset })
      expect(state.mode).toBe(mode)
      send({ type: "completed", id: command.id })
    }
  }
  const layout = (
    value = layoutFixture(),
    offset = state.offset,
    physicalMax = Math.max(0, value.totalSize - value.viewportHeight)
  ) =>
    send({
      type: "layout",
      layout: value,
      observation: { offset, physicalMax, liveMax: physicalMax },
      driverId: null,
    })
  const observed = (offset: number, physicalMax = 1200) =>
    send({
      type: "observed",
      observation: { offset, physicalMax, liveMax: physicalMax },
      driverId: null,
    })
  const input = (direction: "away" | "toward" | "none") =>
    send({
      type: "input",
      direction,
      observation: {
        offset: state.offset,
        physicalMax: Math.max(
          0,
          (state.layout?.totalSize ?? 0) - (state.layout?.viewportHeight ?? 0)
        ),
        liveMax: Math.max(
          0,
          (state.layout?.totalSize ?? 0) - (state.layout?.viewportHeight ?? 0)
        ),
      },
    })
  return {
    get state() {
      return state
    },
    send,
    acknowledge,
    layout,
    observed,
    input,
  }
}
function following() {
  const subject = machine()
  subject.acknowledge(subject.layout())
  return subject
}
function growLast(amount = 200) {
  const value = layoutFixture()
  return {
    ...value,
    totalSize: value.totalSize + amount,
    rows: value.rows.map((row, index) =>
      index === 2 ? { ...row, size: row.size + amount } : row
    ),
  }
}
const scrolls = (commands: TranscriptViewportCommand[]) =>
  commands.filter((command) => command.type === "scroll")

describe("viewport UX contract", () => {
  it("opens a chat following and does not correct repeated identical layouts", () => {
    const subject = following()
    expect(subject.state.mode.kind).toBe("follow-end")
    expect(subject.state.offset).toBe(1200)
    expect(subject.layout()).toEqual([])
    expect(subject.layout(structuredClone(layoutFixture()))).toEqual([])
  })

  it("releases following before the first upward movement, even 12px from the end", () => {
    const subject = following()
    expect(subject.input("away")).toEqual([])
    expect(subject.state.mode.kind).toBe("reading")
    subject.observed(1188)
    expect(subject.state.mode.kind).toBe("reading")
    expect(subject.layout(growLast())).toEqual([])
    expect(subject.state.offset).toBe(1188)
  })

  it("does not release following for downward intent or an immovable empty viewport", () => {
    const subject = following()
    subject.input("toward")
    expect(subject.state.mode.kind).toBe("follow-end")
    const empty = machine()
    empty.acknowledge(
      empty.layout({ ...layoutFixture(), rows: [], totalSize: 0 })
    )
    empty.input("away")
    expect(empty.state.mode.kind).toBe("follow-end")
  })

  it("only native movement towards the end can re-enter following without a request", () => {
    const subject = following()
    subject.input("away")
    subject.observed(1188)
    subject.input("toward")
    expect(subject.state.mode.kind).toBe("reading")
    subject.observed(1198)
    expect(subject.state.mode.kind).toBe("follow-end")
    const command = scrolls(subject.layout(growLast()))[0]!
    expect(command.offset).toBe(1400)
  })

  it.each(["scroll first", "layout first"])(
    "normalizes native movement before its event: %s",
    (order) => {
      const subject = following()
      subject.input("away")
      if (order === "scroll first") subject.observed(1188)
      expect(scrolls(subject.layout(growLast(), 1188))).toEqual([])
      if (order === "layout first") subject.observed(1188, 1400)
      expect(subject.state.offset).toBe(1188)
      expect(subject.state.mode).toEqual({
        kind: "reading",
        anchor: { key: "slot:2", offsetWithinRow: 188 },
      })
    }
  )

  it("recognizes scrollbar movement without a preceding input event", () => {
    const subject = following()
    subject.layout(layoutFixture(), 1188)
    expect(subject.state.mode.kind).toBe("reading")
    expect(subject.layout(growLast())).toEqual([])
  })

  it("uses live geometry for following even while exit layers extend physical overflow", () => {
    const subject = following()
    subject.observed(1100)
    subject.send({
      type: "observed",
      observation: { offset: 1190, physicalMax: 1800, liveMax: 1200 },
      driverId: null,
    })
    expect(subject.state.mode.kind).toBe("follow-end")
  })

  it("compensates changes above the anchor once, without changing reading mode", () => {
    const subject = following()
    subject.observed(480)
    const value = layoutFixture()
    const changed = {
      ...value,
      totalSize: 1650,
      rows: value.rows.map((row, index) =>
        index === 0
          ? { ...row, size: row.size + 150 }
          : { ...row, start: row.start + 150 }
      ),
    }
    const commands = subject.layout(changed)
    expect(scrolls(commands)[0]?.offset).toBe(630)
    subject.acknowledge(commands)
    expect(subject.state.mode.kind).toBe("reading")
    expect(subject.layout(changed)).toEqual([])
  })

  it("keeps browser shrink clamps distinct from user movement and rebases the reading point", () => {
    const subject = following()
    subject.observed(800)
    const shrunk = {
      ...layoutFixture(),
      totalSize: 700,
      rows: [{ ...layoutFixture().rows[0]!, size: 700 }],
    }
    expect(subject.layout(shrunk, 400)).toEqual([])
    expect(subject.state.mode.kind).toBe("reading")
    expect(subject.state.offset).toBe(400)
    expect(
      subject.layout({
        ...shrunk,
        totalSize: 1000,
        rows: [{ ...shrunk.rows[0]!, size: 1000 }],
      })
    ).toEqual([])
  })

  it("preserves the clamped origin when an empty reading transcript is populated again", () => {
    const subject = following()
    subject.observed(1188)
    subject.acknowledge(
      subject.layout({ ...layoutFixture(), rows: [], totalSize: 0 }, 0)
    )
    expect(subject.state.mode).toEqual({ kind: "reading", anchor: null })
    expect(subject.layout(layoutFixture(), 0)).toEqual([])
    expect(subject.state.offset).toBe(0)
    expect(subject.state.mode.kind).toBe("reading")
  })

  it("consumes version alignment once and adopts the resulting ordinary mode", () => {
    const subject = following()
    const request = {
      kind: "version",
      slotKey: "slot:1",
      messageId: "replacement",
      viewportY: 200,
    } as const
    expect(subject.send({ type: "request", request })).toEqual([
      { type: "retain", key: "slot:1" },
    ])
    expect(subject.layout()).toEqual([])
    const replacement = {
      ...layoutFixture(),
      rows: layoutFixture().rows.map((row, index) =>
        index === 1 ? { ...row, messageId: "replacement" } : row
      ),
    }
    const commands = subject.layout(replacement)
    expect(scrolls(commands)[0]?.offset).toBe(750)
    subject.acknowledge(commands)
    expect(subject.state.operation).toBeNull()
    expect(subject.state.mode.kind).toBe("reading")
    const growth = {
      ...replacement,
      totalSize: 1700,
      rows: replacement.rows.map((row, index) =>
        index === 1
          ? { ...row, size: row.size + 200 }
          : index === 2
            ? { ...row, start: row.start + 200 }
            : row
      ),
    }
    expect(scrolls(subject.layout(growth))).toEqual([])
  })

  it.each([0, 1200])(
    "clamps a one-time alignment to %s without padding",
    (target) => {
      const subject = following()
      subject.send({
        type: "request",
        request: {
          kind: "version",
          slotKey: "slot:1",
          messageId: "replacement",
          viewportY: target === 0 ? 2000 : -2000,
        },
      })
      const value = {
        ...layoutFixture(),
        rows: layoutFixture().rows.map((row, index) =>
          index === 1 ? { ...row, messageId: "replacement" } : row
        ),
      }
      const commands = subject.layout(value)
      subject.acknowledge(commands)
      expect(subject.state.offset).toBe(target)
      expect(subject.state.operation).toBeNull()
      expect(subject.state.mode.kind).toBe(
        target === 0 ? "reading" : "follow-end"
      )
    }
  )

  it("waits for a virtual target to mount rather than scrolling estimated geometry", () => {
    const subject = following()
    const value = {
      ...layoutFixture(),
      rows: layoutFixture().rows.map((row, index) =>
        index === 0 ? { ...row, measured: false } : row
      ),
    }
    subject.layout(value)
    expect(
      subject.send({
        type: "request",
        request: { kind: "message", messageId: "a" },
      })
    ).toEqual([{ type: "retain", key: "slot:0" }])
    expect(scrolls(subject.layout(value))).toEqual([])
    const commands = subject.layout()
    expect(scrolls(commands)[0]?.offset).toBe(0)
    subject.acknowledge(commands)
    expect(subject.state.mode.kind).toBe("reading")
  })

  it("retains a reveal when its off-path target first enters the layout", () => {
    const subject = following()
    subject.send({
      type: "request",
      request: { kind: "message", messageId: "off-path" },
    })
    const value = {
      ...layoutFixture(),
      rows: layoutFixture().rows.map((row, index) =>
        index === 0 ? { ...row, messageId: "off-path", measured: false } : row
      ),
    }
    expect(subject.layout(value)).toEqual([{ type: "retain", key: "slot:0" }])
  })

  it("lets user movement cancel alignment and ignores a late failure", () => {
    const subject = following()
    subject.send({
      type: "request",
      request: {
        kind: "version",
        slotKey: "slot:1",
        messageId: "replacement",
        viewportY: 200,
      },
    })
    const id = subject.state.operation!.id
    subject.input("away")
    subject.observed(1100)
    subject.send({ type: "failed", id })
    expect(subject.state.operation).toBeNull()
    expect(subject.state.mode.kind).toBe("reading")
  })

  it("does not let a failed or completed old operation cancel a newer request", () => {
    const subject = following()
    subject.send({
      type: "request",
      request: { kind: "message", messageId: "old" },
    })
    const id = subject.state.operation!.id
    subject.send({
      type: "request",
      request: { kind: "message", messageId: "new" },
    })
    const current = subject.state
    subject.send({ type: "failed", id })
    subject.send({ type: "applied", id, offset: 0 })
    subject.send({ type: "completed", id })
    expect(subject.state).toBe(current)
  })

  it("attributes smooth progress to its command and interrupts it on input", () => {
    const subject = following()
    const commands = subject.send({
      type: "request",
      request: {
        kind: "bounds",
        top: 300,
        bottom: 400,
        align: "start",
        behavior: "smooth",
      },
    })
    const id = scrolls(commands)[0]!.id
    subject.send({
      type: "observed",
      driverId: id,
      observation: { offset: 900, physicalMax: 1200, liveMax: 1200 },
    })
    expect(subject.state.mode.kind).toBe("follow-end")
    expect(subject.input("away")).toContainEqual({ type: "stop-scroll", id })
    expect(subject.state.mode.kind).toBe("reading")
    const state = subject.state
    subject.send({ type: "applied", id, offset: 300 })
    expect(subject.state).toBe(state)
  })

  it("ignores non-scrolling input and adopts the interrupted point on downward input", () => {
    const subject = following()
    const commands = subject.send({
      type: "request",
      request: {
        kind: "bounds",
        top: 300,
        bottom: 400,
        align: "start",
        behavior: "smooth",
      },
    })
    const id = scrolls(commands)[0]!.id
    subject.send({
      type: "observed",
      driverId: id,
      observation: { offset: 900, physicalMax: 1200, liveMax: 1200 },
    })
    const state = subject.state
    expect(subject.input("none")).toEqual([])
    expect(subject.state).toBe(state)
    subject.input("toward")
    expect(subject.state.mode.kind).toBe("reading")
    expect(subject.state.offset).toBe(900)
  })

  it("taking a scrollbar only interrupts a pending operation, with movement choosing the mode", () => {
    const subject = following()
    subject.send({
      type: "control-started",
      observation: { offset: 1200, physicalMax: 1200, liveMax: 1200 },
    })
    expect(subject.state.mode.kind).toBe("follow-end")
    const commands = subject.send({
      type: "request",
      request: {
        kind: "bounds",
        top: 300,
        bottom: 400,
        align: "start",
        behavior: "smooth",
      },
    })
    const id = scrolls(commands)[0]!.id
    subject.send({
      type: "observed",
      driverId: id,
      observation: { offset: 900, physicalMax: 1200, liveMax: 1200 },
    })
    expect(
      subject.send({
        type: "control-started",
        observation: { offset: 900, physicalMax: 1200, liveMax: 1200 },
      })
    ).toContainEqual({ type: "stop-scroll", id })
    subject.observed(888)
    subject.send({ type: "completed", id })
    expect(subject.state.mode.kind).toBe("reading")
    expect(subject.state.offset).toBe(888)
  })

  it("sending growth and draft persistence preserve a reading point near the end", () => {
    const subject = following()
    subject.input("away")
    subject.observed(1188)
    subject.send({ type: "handoff" })
    const restored = machine(
      createTranscriptViewport(transcriptViewportHandoff(subject.state))
    )
    expect(restored.state.offset).toBe(0)
    const commands = restored.layout(growLast(), 0)
    expect(scrolls(commands)[0]?.offset).toBe(1188)
    restored.acknowledge(commands)
    expect(restored.state.mode.kind).toBe("reading")
    expect(restored.state.offset).toBe(1188)
    expect(restored.layout(growLast())).toEqual([])
  })

  it("jump-to-end explicitly restores following", () => {
    const subject = following()
    subject.observed(500)
    const commands = subject.send({ type: "jump-to-end" })
    subject.acknowledge(commands)
    expect(subject.state.mode.kind).toBe("follow-end")
    expect(subject.state.offset).toBe(1200)
  })
})
