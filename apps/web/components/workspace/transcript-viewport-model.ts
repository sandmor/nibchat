/**
 * Linear transcript UX contract. This module has no browser or React dependencies.
 *
 * Following and reading are the only persistent modes. Input away from the end
 * releases following before native scrolling; only downward native movement or
 * completion of an explicit position request may enter following near the end.
 * Layout changes, boundary clamps, and driver acknowledgements NEVER choose a mode.
 *
 * A version/reveal is one replaceable operation, not a third mode. It waits for
 * its committed, mounted target, positions once, then adopts the resulting point.
 * User movement wins over operations; operation IDs make late completions inert.
 * Sending has no transition. A draft handoff carries the same reader snapshot.
 *
 * Transition                         Mode                Positioning
 * upward input/native movement       reading             cancel active request
 * downward native movement at edge   following           browser-owned movement
 * jump to end                        following           immediate command
 * layout/driver acknowledgement      unchanged           solve only changed geometry
 * explicit request completion        resulting position  consume operation once
 * send/draft handoff                  unchanged           retain reading point
 *
 * A layout may make a pending target ready. That completes the already-explicit
 * request; the layout itself never grants permission to resume following.
 *
 * Extension rule: add a semantic event and its contract/sequence tests here.
 * Adapters normalize facts; geometry functions solve constraints; only commands
 * authorize outer scroll writes. Repeated geometry must not produce corrections.
 */
export const TRANSCRIPT_LIVE_EDGE_PX = 64
export const TRANSCRIPT_OFFSET_EPSILON = 1

export type TranscriptGeometry = {
  key: string
  start: number
  size: number
}

export type ReadingAnchor = { key: string; offsetWithinRow: number }

export type TranscriptViewportMode =
  | { kind: "follow-end" }
  // An empty transcript has a reader origin, but no row to anchor yet.
  | { kind: "reading"; anchor: ReadingAnchor | null }

export function clampTranscriptOffset(
  offset: number,
  maxScroll: number
): number {
  return Math.min(Math.max(0, offset), Math.max(0, maxScroll))
}

export function alignedTranscriptOffset(
  contentY: number,
  viewportY: number,
  maxScroll: number
): number {
  return clampTranscriptOffset(contentY - viewportY, maxScroll)
}

export function transcriptAtEnd(scrollTop: number, maxScroll: number): boolean {
  return maxScroll - scrollTop <= TRANSCRIPT_LIVE_EDGE_PX
}

/** Physical scroll movement, excluding the browser's clamp after shrinkage. */
export function unobservedTranscriptScroll(
  observed: number,
  current: number,
  maxScroll: number
): number {
  return current - clampTranscriptOffset(observed, maxScroll)
}

/** Preserve a row point, or a surviving neighbor when that row was removed. */
export function readingTranscriptOffset(input: {
  anchor: ReadingAnchor
  previous: readonly TranscriptGeometry[]
  next: readonly TranscriptGeometry[]
  previousScrollTop: number
  maxScroll: number
}): number {
  const { anchor, previous, next, previousScrollTop, maxScroll } = input
  const current = next.find((row) => row.key === anchor.key)
  if (current)
    return clampTranscriptOffset(
      current.start + anchor.offsetWithinRow,
      maxScroll
    )

  const previousIndex = previous.findIndex((row) => row.key === anchor.key)
  const nextByKey = new Map(next.map((row) => [row.key, row]))
  const neighbors = [
    ...previous.slice(0, previousIndex).reverse(),
    ...previous.slice(previousIndex + 1),
  ]
  for (const old of neighbors) {
    const surviving = nextByKey.get(old.key)
    if (surviving)
      return alignedTranscriptOffset(
        surviving.start,
        old.start - previousScrollTop,
        maxScroll
      )
  }
  return clampTranscriptOffset(previousScrollTop, maxScroll)
}

export function transcriptNavigationOffset(input: {
  top: number
  bottom: number
  scrollTop: number
  viewportHeight: number
  maxScroll: number
  align: "start" | "end" | "nearest"
}): number {
  const { top, bottom, scrollTop, viewportHeight, maxScroll, align } = input
  if (align === "start") return clampTranscriptOffset(top, maxScroll)
  if (align === "end")
    return clampTranscriptOffset(bottom - viewportHeight, maxScroll)
  if (top >= scrollTop && bottom <= scrollTop + viewportHeight) return scrollTop
  if (top < scrollTop && bottom > scrollTop + viewportHeight) return scrollTop
  return clampTranscriptOffset(
    top < scrollTop ? top : bottom - viewportHeight,
    maxScroll
  )
}

export type TranscriptLayoutRow = TranscriptGeometry & {
  messageId: string | null
  measured: boolean
  stepperOffset: number | null
}
export type TranscriptLayout = {
  rows: readonly TranscriptLayoutRow[]
  totalSize: number
  viewportHeight: number
  paddingStart: number
}
export type TranscriptObservation = {
  offset: number
  /** Includes paint-only exit overflow; used only to recognize browser clamps. */
  physicalMax: number
  /** The measured live transcript range, which determines follow eligibility. */
  liveMax: number
}
export type TranscriptPositionBehavior = "instant" | "smooth"
export type TranscriptReveal =
  | { kind: "version"; slotKey: string; messageId: string; viewportY: number }
  | { kind: "message"; messageId: string }
  | {
      kind: "bounds"
      top: number
      bottom: number
      align: "start" | "end" | "nearest"
      behavior: TranscriptPositionBehavior
    }
type WaitingOperation = {
  kind: "waiting"
  id: number
  request: TranscriptReveal
}
type PositioningOperation = {
  kind: "positioning"
  id: number
  offset: number
  behavior: TranscriptPositionBehavior
  adopt: boolean
  retainedKey: string | null
}
export type TranscriptOperation = WaitingOperation | PositioningOperation
export type TranscriptViewportHandoff = {
  mode: TranscriptViewportMode
  basis: { rows: readonly TranscriptGeometry[]; offset: number }
}
export type TranscriptViewportState = TranscriptViewportHandoff & {
  offset: number
  layout: TranscriptLayout | null
  operation: TranscriptOperation | null
  nextId: number
}
export type TranscriptViewportEvent =
  | {
      type: "layout"
      layout: TranscriptLayout
      observation: TranscriptObservation
      driverId: number | null
    }
  | {
      type: "observed"
      observation: TranscriptObservation
      driverId: number | null
    }
  | {
      type: "input"
      direction: "away" | "toward" | "none"
      observation: TranscriptObservation
    }
  | { type: "control-started"; observation: TranscriptObservation }
  | { type: "request"; request: TranscriptReveal }
  | { type: "jump-to-end" }
  | { type: "applied"; id: number; offset: number }
  | { type: "completed"; id: number }
  | { type: "failed"; id: number }
  | { type: "handoff" }
export type TranscriptViewportCommand =
  | {
      type: "scroll"
      id: number
      offset: number
      behavior: TranscriptPositionBehavior
    }
  | { type: "stop-scroll"; id: number }
  | { type: "retain"; key: string | null }

export function createTranscriptViewport(
  handoff?: TranscriptViewportHandoff
): TranscriptViewportState {
  return {
    mode: handoff?.mode ?? { kind: "follow-end" },
    basis: handoff?.basis ?? { rows: [], offset: 0 },
    // A mount starts at the browser's origin. The carried basis describes the
    // desired reading point, never an observed offset in this new scrollport.
    offset: 0,
    layout: null,
    operation: null,
    nextId: 1,
  }
}

/** Mount handoff deliberately excludes pending operations and browser identities. */
export function transcriptViewportHandoff(
  state: TranscriptViewportState
): TranscriptViewportHandoff {
  return { mode: state.mode, basis: state.basis }
}

function readingMode(
  state: TranscriptViewportState,
  offset: number
): TranscriptViewportMode {
  const rows = state.layout?.rows ?? state.basis.rows
  const row =
    rows.find((item) => item.start + item.size > offset) ?? rows.at(-1)
  return row
    ? {
        kind: "reading",
        anchor: { key: row.key, offsetWithinRow: offset - row.start },
      }
    : { kind: "reading", anchor: null }
}

function sameGeometry(
  previous: TranscriptLayout | null,
  next: TranscriptLayout
): boolean {
  return (
    previous !== null &&
    previous.totalSize === next.totalSize &&
    previous.viewportHeight === next.viewportHeight &&
    previous.paddingStart === next.paddingStart &&
    previous.rows.length === next.rows.length &&
    previous.rows.every((row, index) => {
      const item = next.rows[index]!
      return (
        row.key === item.key &&
        row.start === item.start &&
        row.size === item.size
      )
    })
  )
}

function retainedKey(state: TranscriptViewportState): string | null {
  const operation = state.operation
  if (!operation) return null
  if (operation.kind === "positioning") return operation.retainedKey
  const request = operation.request
  if (request.kind === "version") return request.slotKey
  if (request.kind === "message")
    return (
      state.layout?.rows.find((row) => row.messageId === request.messageId)
        ?.key ?? null
    )
  return null
}

export function transitionTranscriptViewport(
  state: TranscriptViewportState,
  event: TranscriptViewportEvent
): { state: TranscriptViewportState; commands: TranscriptViewportCommand[] } {
  let next = state
  const commands: TranscriptViewportCommand[] = []
  const patch = (value: Partial<TranscriptViewportState>) => {
    next = { ...next, ...value }
  }
  const maxScroll = () =>
    next.layout
      ? Math.max(0, next.layout.totalSize - next.layout.viewportHeight)
      : 0
  const recordPoint = (offset: number, adopt = false) => {
    patch({
      offset,
      mode:
        adopt && transcriptAtEnd(offset, maxScroll())
          ? { kind: "follow-end" }
          : adopt || next.mode.kind === "reading"
            ? readingMode(next, offset)
            : next.mode,
      basis: { rows: next.layout?.rows ?? next.basis.rows, offset },
    })
  }
  const cancel = () => {
    const operation = next.operation
    if (!operation) return
    if (operation.kind === "positioning" && operation.behavior === "smooth")
      commands.push({ type: "stop-scroll", id: operation.id })
    if (retainedKey(next) !== null) commands.push({ type: "retain", key: null })
    patch({ operation: null })
  }
  const observe = (
    observation: TranscriptObservation,
    driverId: number | null
  ) => {
    const operation = next.operation
    if (operation?.kind === "positioning" && driverId === operation.id) {
      patch({ offset: observation.offset })
      return
    }
    const movement = unobservedTranscriptScroll(
      next.offset,
      observation.offset,
      observation.physicalMax
    )
    if (Math.abs(movement) <= TRANSCRIPT_OFFSET_EPSILON) {
      // The browser may have clamped after shrinkage. Keep the old anchor basis
      // until the new geometry is solved; clamping is not a user decision.
      if (next.offset !== observation.offset)
        patch({ offset: observation.offset })
      return
    }
    cancel()
    patch({
      mode:
        movement > 0 && transcriptAtEnd(observation.offset, observation.liveMax)
          ? { kind: "follow-end" }
          : readingMode(next, observation.offset),
    })
    recordPoint(observation.offset)
  }
  const takeControl = (observation: TranscriptObservation) => {
    const wasPositioning = next.operation?.kind === "positioning"
    cancel()
    observe(observation, null)
    if (wasPositioning) recordPoint(observation.offset, true)
  }
  const position = (
    offset: number,
    behavior: TranscriptPositionBehavior,
    adopt: boolean,
    id = next.nextId
  ) => {
    const target = clampTranscriptOffset(offset, maxScroll())
    const key = retainedKey(next)
    patch({ nextId: Math.max(next.nextId, id + 1) })
    if (Math.abs(target - next.offset) <= TRANSCRIPT_OFFSET_EPSILON) {
      patch({ operation: null })
      if (key !== null) commands.push({ type: "retain", key: null })
      recordPoint(next.offset, adopt)
      return
    }
    patch({
      operation: {
        kind: "positioning",
        id,
        offset: target,
        behavior,
        adopt,
        retainedKey: key,
      },
    })
    commands.push({ type: "scroll", id, offset: target, behavior })
  }
  const resolveRequest = () => {
    const operation = next.operation
    const layout = next.layout
    if (operation?.kind !== "waiting" || !layout) return
    const request = operation.request
    if (request.kind === "bounds") {
      position(
        transcriptNavigationOffset({
          ...request,
          scrollTop: next.offset,
          viewportHeight: layout.viewportHeight,
          maxScroll: maxScroll(),
        }),
        request.behavior,
        true,
        operation.id
      )
      return
    }
    const row = layout.rows.find((item) =>
      request.kind === "version"
        ? item.key === request.slotKey && item.messageId === request.messageId
        : item.messageId === request.messageId
    )
    if (
      !row?.measured ||
      (request.kind === "version" && row.stepperOffset === null)
    )
      return
    const offset =
      request.kind === "version"
        ? alignedTranscriptOffset(
            row.start + row.stepperOffset!,
            request.viewportY,
            maxScroll()
          )
        : row.start - layout.paddingStart
    position(offset, "instant", true, operation.id)
  }

  switch (event.type) {
    case "observed":
      observe(event.observation, event.driverId)
      break
    case "input": {
      if (event.direction === "none") break
      takeControl(event.observation)
      if (event.direction === "away" && event.observation.offset > 0) {
        patch({ mode: readingMode(next, event.observation.offset) })
        recordPoint(event.observation.offset)
      }
      break
    }
    case "control-started":
      // Taking a scrollbar does not itself release following. It does stop an
      // active reveal, so subsequent native movement is not mistaken for animation.
      takeControl(event.observation)
      break
    case "layout": {
      // Consume native movement against the previous geometry BEFORE solving
      // the new one. React commits and scroll events may arrive in either order.
      observe(event.observation, event.driverId)
      const changed = !sameGeometry(next.layout, event.layout)
      const beforeRetained = retainedKey(next)
      patch({ layout: event.layout })
      const afterRetained = retainedKey(next)
      if (beforeRetained !== afterRetained)
        commands.push({ type: "retain", key: afterRetained })
      if (next.operation?.kind === "waiting") resolveRequest()
      else if (!next.operation && changed) {
        position(
          next.mode.kind === "follow-end"
            ? maxScroll()
            : next.mode.anchor
              ? readingTranscriptOffset({
                  anchor: next.mode.anchor,
                  previous: next.basis.rows,
                  next: event.layout.rows,
                  previousScrollTop: next.basis.offset,
                  maxScroll: maxScroll(),
                })
              : next.basis.offset,
          "instant",
          false
        )
      }
      break
    }
    case "request": {
      cancel()
      const id = next.nextId
      patch({
        nextId: id + 1,
        operation: { kind: "waiting", id, request: event.request },
      })
      const key = retainedKey(next)
      if (key !== null) commands.push({ type: "retain", key })
      resolveRequest()
      break
    }
    case "jump-to-end":
      cancel()
      patch({ mode: { kind: "follow-end" } })
      position(maxScroll(), "instant", false)
      break
    case "applied": {
      const operation = next.operation
      if (operation?.kind !== "positioning" || operation.id !== event.id) break
      // Acknowledgement reports a coordinate, never user intent or completion.
      patch({ offset: event.offset })
      break
    }
    case "completed": {
      const operation = next.operation
      if (operation?.kind !== "positioning" || operation.id !== event.id) break
      if (operation.retainedKey !== null)
        commands.push({ type: "retain", key: null })
      patch({ operation: null })
      // Only the completion of an explicit request adopts its resulting point.
      // Completing a geometry compensation preserves the persistent mode.
      recordPoint(next.offset, operation.adopt)
      break
    }
    case "failed":
      if (next.operation?.id === event.id) cancel()
      break
    case "handoff":
      cancel()
      recordPoint(next.offset)
      break
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
  return { state: next, commands }
}
