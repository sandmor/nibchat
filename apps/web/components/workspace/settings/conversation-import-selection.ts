import type { ImportRecord } from "@/lib/imports/model"

export type ImportMatchingSelection = {
  chats: Set<string>
  entities: Set<string>
}

export function selectMatchingChats(
  current: ImportMatchingSelection,
  visibleChats: ImportRecord[]
): ImportMatchingSelection {
  const chats = new Set(current.chats)
  const entities = new Set(current.entities)
  for (const record of visibleChats) {
    chats.add(record.sourceId)
    if (record.entityId) entities.add(record.entityId)
  }
  return { chats, entities }
}

export function clearMatchingChats(
  current: ImportMatchingSelection,
  visibleChats: ImportRecord[]
): ImportMatchingSelection {
  const chats = new Set(current.chats)
  for (const record of visibleChats) chats.delete(record.sourceId)
  return { chats, entities: new Set(current.entities) }
}

export function selectMatchingEntities(
  current: ImportMatchingSelection,
  entityIds: Iterable<string>
): ImportMatchingSelection {
  const entities = new Set(current.entities)
  for (const id of entityIds) entities.add(id)
  return { chats: new Set(current.chats), entities }
}

export function clearMatchingEntities(
  current: ImportMatchingSelection,
  entityIds: Iterable<string>,
  records: ImportRecord[]
): ImportMatchingSelection {
  const removed = new Set(entityIds)
  const entities = new Set(current.entities)
  const chats = new Set(current.chats)
  for (const id of removed) entities.delete(id)
  for (const record of records)
    if (record.entityId && removed.has(record.entityId))
      chats.delete(record.sourceId)
  return { chats, entities }
}

export function countSelected(
  ids: Iterable<string>,
  selected: Set<string>
): number {
  let count = 0
  for (const id of ids) if (selected.has(id)) count++
  return count
}
