/**
 * Pure geometry patch for the transcript adapter.
 * The viewport model still receives a full layout and still decides offsets.
 * Unchanged rows keep their object identity so a tail resize does not clone
 * the history above it.
 */
export function patchTranscriptLayoutRows<
  Row extends { start: number; size: number },
>(
  previous: readonly Row[],
  flat: ArrayLike<number>,
  count: number
): readonly Row[] | null {
  if (previous.length !== count || flat.length < count * 2) return null
  let changedAt = -1
  for (let index = 0; index < count; index++) {
    const row = previous[index]!
    if (row.start !== flat[index * 2] || row.size !== flat[index * 2 + 1]) {
      changedAt = index
      break
    }
  }
  if (changedAt < 0) return previous
  const next = previous.slice()
  for (let index = changedAt; index < count; index++) {
    const start = flat[index * 2]!
    const size = flat[index * 2 + 1]!
    const row = previous[index]!
    if (row.start === start && row.size === size) continue
    next[index] = { ...row, start, size }
  }
  return next
}
