import { z } from "zod"
import {
  MAX_DESCRIPTION,
  MAX_NAME,
  MAX_SPACE_DEPTH,
} from "@/lib/limits"
import type { SpaceRow } from "@/lib/types"
import { parseSpaceSettings, type SpaceSettings } from "@/lib/spaces/settings"

export type SpaceRecord = {
  id: string
  parent_id: string | null
  name: string
  settings: SpaceSettings
}

export function spaceFromRow(
  row: Pick<SpaceRow, "id" | "parent_id" | "name" | "settings_json">
): SpaceRecord {
  return {
    id: row.id,
    parent_id: row.parent_id,
    name: row.name,
    settings: parseSpaceSettings(row.settings_json),
  }
}

export function spacesById(
  spaces: readonly SpaceRecord[]
): Map<string, SpaceRecord> {
  return new Map(spaces.map((space) => [space.id, space]))
}

/** Root-first ancestor chain, including `spaceId`. */
export function spaceChain(
  spaceId: string | null | undefined,
  byId: Map<string, SpaceRecord>
): SpaceRecord[] {
  if (!spaceId) return []
  const chain: SpaceRecord[] = []
  const seen = new Set<string>()
  let current = byId.get(spaceId)
  while (current) {
    if (seen.has(current.id)) break
    seen.add(current.id)
    chain.unshift(current)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return chain
}

export function spaceSubtreeIds(
  spaceId: string,
  spaces: readonly { id: string; parent_id: string | null }[]
): Set<string> {
  const children = new Map<string | null, string[]>()
  for (const space of spaces) {
    const list = children.get(space.parent_id) ?? []
    list.push(space.id)
    children.set(space.parent_id, list)
  }
  const ids = new Set<string>()
  const stack = [spaceId]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (ids.has(current)) continue
    ids.add(current)
    for (const child of children.get(current) ?? []) stack.push(child)
  }
  return ids
}

/** 1 = top-level space. Missing id is 0. */
export function spaceDepth(
  spaceId: string | null | undefined,
  byId: Map<string, SpaceRecord>
): number {
  return spaceChain(spaceId, byId).length
}

/** 1 = leaf. Missing id is 0. */
export function spaceSubtreeHeight(
  spaceId: string,
  spaces: readonly SpaceRecord[]
): number {
  const children = new Map<string | null, string[]>()
  for (const space of spaces) {
    const list = children.get(space.parent_id) ?? []
    list.push(space.id)
    children.set(space.parent_id, list)
  }
  function height(id: string, seen: Set<string>): number {
    if (seen.has(id)) return 1
    seen.add(id)
    const kids = children.get(id) ?? []
    if (kids.length === 0) return 1
    return 1 + Math.max(...kids.map((kid) => height(kid, seen)))
  }
  return height(spaceId, new Set())
}

function wouldCreateCycle(
  spaceId: string,
  newParentId: string | null,
  spaces: readonly SpaceRecord[]
): boolean {
  if (!newParentId) return false
  if (newParentId === spaceId) return true
  return spaceSubtreeIds(spaceId, spaces).has(newParentId)
}

export function assertSpaceMoveAllowed(
  spaceId: string,
  newParentId: string | null,
  spaces: readonly SpaceRecord[]
) {
  if (wouldCreateCycle(spaceId, newParentId, spaces)) {
    throw new Error("A space cannot contain itself")
  }
  const byId = spacesById(spaces)
  const parentDepth = newParentId ? spaceDepth(newParentId, byId) : 0
  const height = spaceSubtreeHeight(spaceId, spaces)
  if (parentDepth + height > MAX_SPACE_DEPTH) {
    throw new Error(`Spaces can nest at most ${MAX_SPACE_DEPTH} levels`)
  }
}

/** Topological order so a space is inserted after its parent. */
export function orderSpacesForInsert<
  T extends { id: string; parent_id: string | null },
>(spaces: T[] | undefined): T[] {
  if (!spaces?.length) return []
  const byId = new Map(spaces.map((space) => [space.id, space]))
  if (byId.size !== spaces.length) throw new Error("Duplicate space ids")
  const ordered: T[] = []
  const seen = new Set<string>()
  function visit(id: string, stack: Set<string>) {
    if (seen.has(id)) return
    if (stack.has(id)) throw new Error("Spaces contain a cycle")
    const space = byId.get(id)
    if (!space) throw new Error(`Unknown space ${id}`)
    stack.add(id)
    if (space.parent_id) {
      if (!byId.has(space.parent_id)) {
        throw new Error(
          `Space ${id} references missing parent ${space.parent_id}`
        )
      }
      visit(space.parent_id, stack)
    }
    stack.delete(id)
    seen.add(id)
    ordered.push(space)
  }
  for (const space of spaces) visit(space.id, new Set())
  return ordered
}

export const spaceNameSchema = z.string().trim().min(1).max(MAX_NAME)
export const spaceDescriptionSchema = z.string().max(MAX_DESCRIPTION)
