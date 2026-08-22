import { existsSync } from "node:fs"
import path from "node:path"

/** Walk up from cwd (or start) until pnpm-workspace.yaml is found. */
export function monorepoRoot(start = process.cwd()): string {
  let dir = path.resolve(/* turbopackIgnore: true */ start)
  for (;;) {
    const workspaceFile = path.join(
      /* turbopackIgnore: true */ dir,
      "pnpm-workspace.yaml"
    )
    if (existsSync(/* turbopackIgnore: true */ workspaceFile)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return path.resolve(/* turbopackIgnore: true */ start)
    dir = parent
  }
}

/**
 * Resolve SQLITE_PATH relative to monorepo root (default `./data/nibchat.db`).
 * Absolute paths and `:memory:` are returned as-is.
 */
export function resolveSqlitePath(
  raw = process.env.SQLITE_PATH ?? "./data/nibchat.db"
): string {
  if (raw === ":memory:" || path.isAbsolute(raw)) return raw
  return path.resolve(/* turbopackIgnore: true */ monorepoRoot(), raw)
}
