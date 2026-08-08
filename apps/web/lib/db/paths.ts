import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

/** Walk up from cwd (or start) until pnpm-workspace.yaml is found. */
export function monorepoRoot(start = process.cwd()): string {
  let dir = path.resolve(start)
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return path.resolve(start)
    dir = parent
  }
}

/**
 * Resolve SQLITE_PATH relative to monorepo root (default `./data/vero.db`).
 * Absolute paths and `:memory:` are returned as-is.
 */
export function resolveSqlitePath(
  raw = process.env.SQLITE_PATH ?? "./data/vero.db"
): string {
  if (raw === ":memory:" || path.isAbsolute(raw)) return raw
  return path.resolve(monorepoRoot(), raw)
}

/**
 * Load monorepo-root env into process.env (does not override existing vars).
 * Used by next.config and CLI scripts; Next itself still only looks under apps/web.
 */
export function loadRootEnv(root = monorepoRoot()): void {
  for (const name of [".env", ".env.local"]) {
    const file = path.join(root, name)
    if (!existsSync(file)) continue
    applyDotEnv(readFileSync(file, "utf8"))
  }
}

function applyDotEnv(content: string): void {
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    if (process.env[key] !== undefined) continue
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}
