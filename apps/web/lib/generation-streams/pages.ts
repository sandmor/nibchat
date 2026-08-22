/**
 * Drain a cursor-paged log. A single page may be truncated by the backend;
 * callers that need the full history (crash replay) must loop until empty.
 */
export async function collectPages<T>(
  readPage: (after: string | null) => Promise<T[]>,
  cursorOf: (item: T) => string
): Promise<T[]> {
  const all: T[] = []
  let after: string | null = null
  for (;;) {
    const page = await readPage(after)
    if (page.length === 0) return all
    all.push(...page)
    const last = page.at(-1)
    if (!last) return all
    after = cursorOf(last)
  }
}
