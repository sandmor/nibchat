export type SearchHit = {
  nodeId: string
  start: number
  onPath: boolean
}

export type SearchNode = {
  id: string
  findText: string
}

export function normalizeQuery(query: string): string {
  return query.trim()
}

/** Case-insensitive non-overlapping substring starts. Empty query → no hits. */
export function findOccurrences(searchText: string, query: string): number[] {
  const needle = normalizeQuery(query)
  if (!needle) return []
  const hay = searchText.toLowerCase()
  const needleLower = needle.toLowerCase()
  const starts: number[] = []
  let from = 0
  while (from <= hay.length - needleLower.length) {
    const at = hay.indexOf(needleLower, from)
    if (at < 0) break
    starts.push(at)
    from = at + needleLower.length
  }
  return starts
}

/**
 * Occurrences on the active path first (root → tip, then offset), then the
 * remaining hits in layout walk order.
 */
export function buildHits(
  nodes: readonly SearchNode[],
  query: string,
  options: { pathIds: readonly string[]; layoutIds: readonly string[] }
): SearchHit[] {
  const needle = normalizeQuery(query)
  if (!needle) return []
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const pathSet = new Set(options.pathIds)
  const hits: SearchHit[] = []
  const seen = new Set<string>()

  const pushNode = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const node = byId.get(id)
    if (!node) return
    for (const start of findOccurrences(node.findText, needle)) {
      hits.push({ nodeId: id, start, onPath: pathSet.has(id) })
    }
  }

  for (const id of options.pathIds) pushNode(id)
  for (const id of options.layoutIds) {
    if (pathSet.has(id)) continue
    pushNode(id)
  }
  return hits
}

export function pathHits(hits: readonly SearchHit[]): SearchHit[] {
  return hits.filter((hit) => hit.onPath)
}

export function firstOffPathHit(
  hits: readonly SearchHit[]
): SearchHit | undefined {
  return hits.find((hit) => !hit.onPath)
}

export function distinctPathMessageCount(hits: readonly SearchHit[]) {
  return distinctMessageCount(hits, true)
}

export function distinctOffPathMessageCount(hits: readonly SearchHit[]) {
  return distinctMessageCount(hits, false)
}

function distinctMessageCount(hits: readonly SearchHit[], onPath: boolean) {
  const seen = new Set<string>()
  for (const hit of hits) {
    if (hit.onPath === onPath) seen.add(hit.nodeId)
  }
  return seen.size
}

export function stepIndex(index: number, delta: number, length: number) {
  if (length <= 0) return 0
  return (((index + delta) % length) + length) % length
}

export function needsPathConfirm(
  nodeId: string,
  pathIds: ReadonlySet<string> | readonly string[]
) {
  const set = pathIds instanceof Set ? pathIds : new Set(pathIds)
  return !set.has(nodeId)
}

export type PathSwitchPlan =
  | { confirm: false; nodeId: string; pin: string | null; index: number }
  | { confirm: true; nodeId: string; pin: string | null }

/** Locate immediately when on-path; otherwise pin only after confirm. */
export function planPathSwitch(
  nodeId: string,
  hits: readonly SearchHit[],
  pathIds: ReadonlySet<string> | readonly string[]
): PathSwitchPlan {
  const found = firstHitOnNode(hits, nodeId)
  const pin = found ? occurrenceKey(found.hit) : null
  if (!needsPathConfirm(nodeId, pathIds)) {
    return { confirm: false, nodeId, pin, index: found?.index ?? 0 }
  }
  return { confirm: true, nodeId, pin }
}

/** Keep a locate pending only while its key is live; 0 clears a leftover reveal. */
export function nextFindRevealPending(
  previousLocateKey: number,
  locateKey: number,
  pending: number
) {
  if (locateKey <= 0) return 0
  if (locateKey > previousLocateKey) return locateKey
  return pending
}

export function occurrenceKey(hit: SearchHit) {
  return `${hit.nodeId}:${hit.start}`
}

/**
 * Keep the same occurrence across hit-list rebuilds (path switch, layout).
 * Falls back to a clamped index when the pin is missing or no longer present.
 */
export function pinnedOccurrenceIndex(
  hits: readonly SearchHit[],
  key: string | null | undefined,
  fallbackIndex = 0
) {
  if (hits.length === 0) return 0
  if (key) {
    const index = hits.findIndex((hit) => occurrenceKey(hit) === key)
    if (index >= 0) return index
  }
  return Math.min(Math.max(0, fallbackIndex), hits.length - 1)
}

export function snippet(
  findText: string,
  start: number,
  query: string,
  radius = 32
) {
  const needle = normalizeQuery(query)
  const end = start + needle.length
  const from = Math.max(0, start - radius)
  const to = Math.min(findText.length, end + radius)
  let text = findText.slice(from, to).replace(/\s+/g, " ").trim()
  if (from > 0) text = `…${text}`
  if (to < findText.length) text = `${text}…`
  return text
}

export function firstHitOnNode(
  hits: readonly SearchHit[],
  nodeId: string
): { hit: SearchHit; index: number } | null {
  const index = hits.findIndex((hit) => hit.nodeId === nodeId)
  const hit = hits[index]
  if (index < 0 || !hit) return null
  return { hit, index }
}

/** Which occurrence on the current node is active (0-based), or -1. */
export function occurrenceIndexInNode(
  hits: readonly SearchHit[],
  occurrenceIndex: number
) {
  const current = hits[occurrenceIndex]
  if (!current) return -1
  let index = 0
  for (let i = 0; i < occurrenceIndex; i++) {
    if (hits[i]!.nodeId === current.nodeId) index++
  }
  return index
}
