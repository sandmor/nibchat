import type { TreeRect } from "./tree-layout"

export type ScheduleSnapshot = {
  id: string
  parentId: string
  nextRunAt: string
  timeZone: string
  rect: TreeRect
}

export type AssistantSnapshot = {
  id: string
  parentId: string
}

export type ScheduleDeparture = {
  scheduleId: string
  parentId: string
  fromRect: TreeRect
  nextRunAt: string
  timeZone: string
  /** Set when this card becomes a new assistant reply. */
  nodeId: string | null
}

/**
 * A schedule that left the pending set either becomes the new assistant under
 * its parent, or leaves with no reply. One new reply pairs with one schedule.
 */
export function scheduleDepartures(input: {
  previous: readonly ScheduleSnapshot[]
  pendingIds: ReadonlySet<string>
  previousAssistants: readonly AssistantSnapshot[]
  assistants: readonly AssistantSnapshot[]
  activeScheduleIds: ReadonlySet<string>
}): ScheduleDeparture[] {
  const previousAssistantIds = new Set(
    input.previousAssistants.map((node) => node.id)
  )
  const claimed = new Set<string>()
  const departures: ScheduleDeparture[] = []
  const removed = input.previous
    .filter(
      (schedule) =>
        !input.pendingIds.has(schedule.id) &&
        !input.activeScheduleIds.has(schedule.id)
    )
    .sort((left, right) => left.id.localeCompare(right.id))
  for (const schedule of removed) {
    const node = input.assistants.find(
      (assistant) =>
        assistant.parentId === schedule.parentId &&
        !previousAssistantIds.has(assistant.id) &&
        !claimed.has(assistant.id)
    )
    if (node) claimed.add(node.id)
    departures.push({
      scheduleId: schedule.id,
      parentId: schedule.parentId,
      fromRect: { ...schedule.rect },
      nextRunAt: schedule.nextRunAt,
      timeZone: schedule.timeZone,
      nodeId: node?.id ?? null,
    })
  }
  return departures
}

function sameParentReply(
  assistants: readonly AssistantSnapshot[],
  parentId: string,
  previousAssistantIds: ReadonlySet<string>,
  claimed: Set<string>
) {
  return assistants.find(
    (assistant) =>
      assistant.parentId === parentId &&
      !previousAssistantIds.has(assistant.id) &&
      !claimed.has(assistant.id)
  )
}

/**
 * Keep in-flight departures, promote a fade when its reply arrives later, and
 * append schedules that just left the pending set.
 */
export function reconcileScheduleDepartures(input: {
  current: readonly ScheduleDeparture[]
  previous: readonly ScheduleSnapshot[]
  pendingIds: ReadonlySet<string>
  previousAssistants: readonly AssistantSnapshot[]
  assistants: readonly AssistantSnapshot[]
}): ScheduleDeparture[] {
  const previousAssistantIds = new Set(
    input.previousAssistants.map((node) => node.id)
  )
  const claimed = new Set<string>()
  const next = input.current.map((departure) => {
    if (departure.nodeId) {
      claimed.add(departure.nodeId)
      return departure
    }
    const node = sameParentReply(
      input.assistants,
      departure.parentId,
      previousAssistantIds,
      claimed
    )
    if (!node) return departure
    claimed.add(node.id)
    return { ...departure, nodeId: node.id }
  })
  const activeScheduleIds = new Set(next.map((item) => item.scheduleId))
  for (const departure of scheduleDepartures({
    previous: input.previous,
    pendingIds: input.pendingIds,
    previousAssistants: input.previousAssistants,
    assistants: input.assistants,
    activeScheduleIds,
  })) {
    if (departure.nodeId && claimed.has(departure.nodeId)) {
      next.push({ ...departure, nodeId: null })
      continue
    }
    if (departure.nodeId) claimed.add(departure.nodeId)
    next.push(departure)
  }
  return next
}

export function sameScheduleDepartures(
  left: readonly ScheduleDeparture[],
  right: readonly ScheduleDeparture[]
) {
  if (left.length !== right.length) return false
  return left.every((item, index) => {
    const other = right[index]
    return item.scheduleId === other?.scheduleId && item.nodeId === other.nodeId
  })
}
