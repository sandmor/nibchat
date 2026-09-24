import type { NextConfig } from "next"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadRootEnv } from "./lib/root-env"

const monorepoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
)
const pdfRuntimeFiles = [
  "./node_modules/pdfjs-dist/cmaps/**/*",
  "./node_modules/pdfjs-dist/standard_fonts/**/*",
  "./node_modules/@napi-rs/canvas/**/*",
  "./node_modules/@napi-rs/canvas-linux-*/**/*",
]

// Env and SQLite live at the monorepo root (not apps/web).
loadRootEnv(monorepoRoot)

const nextConfig: NextConfig = {
  output: "standalone",
  // Trace workspace deps from monorepo root for the standalone image.
  outputFileTracingRoot: monorepoRoot,
  serverExternalPackages: [
    "better-sqlite3",
    "pg",
    "pdfjs-dist",
    "@napi-rs/canvas",
  ],
  outputFileTracingIncludes: {
    "/api/chat/generations": pdfRuntimeFiles,
  },
}

export default nextConfig
