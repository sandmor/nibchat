/** Sibling order ranks. Gaps leave room for inserts; a full rebalance
 * spreads the group when a midpoint would collide with a neighbor. */
export const SORT_KEY_STEP = 1024

export function sortKeyAfter(maxKey: number | null | undefined) {
  return (maxKey ?? 0) + SORT_KEY_STEP
}

/** Midpoint strictly between `prior` and `next`. `prior` null means a slot
 * before the first sibling. Returns null when floats cannot represent a new
 * rank, so the caller can rebalance. */
export function sortKeyBetween(
  prior: number | null | undefined,
  next: number
): number | null {
  const start = prior == null ? next - SORT_KEY_STEP * 2 : prior
  const mid = (start + next) / 2
  if (mid > start && mid < next) return mid
  return null
}

export function rebalanceSortKeys(orderedIds: readonly string[]) {
  return new Map(
    orderedIds.map((id, index) => [id, (index + 1) * SORT_KEY_STEP])
  )
}

export function siblingSort(
  left: { sort_key: number; created_at: string; id: string },
  right: { sort_key: number; created_at: string; id: string }
) {
  return (
    left.sort_key - right.sort_key ||
    left.created_at.localeCompare(right.created_at) ||
    left.id.localeCompare(right.id)
  )
}
