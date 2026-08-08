import type { NextConfig } from "next"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadRootEnv } from "./lib/db/paths"

// Env and SQLite live at the monorepo root (not apps/web).
loadRootEnv()

const monorepoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
)

const nextConfig: NextConfig = {
  output: "standalone",
  // Trace workspace deps from monorepo root for the standalone image.
  outputFileTracingRoot: monorepoRoot,
  serverExternalPackages: ["better-sqlite3", "pg"],
}

export default nextConfig
