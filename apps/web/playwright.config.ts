import { defineConfig } from "@playwright/test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const e2eDataDir = mkdtempSync(path.join(tmpdir(), "vero-e2e-"))
const sqlitePath = path.join(e2eDataDir, "e2e.db")

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3456"

export default defineConfig({
  testDir: "./e2e",
  // Shared SQLite instance: one worker, sequential files (owner claim then trees).
  fullyParallel: false,
  workers: 1,
  use: { baseURL },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm dev --hostname 127.0.0.1 --port 3456",
        url: baseURL,
        // Always boot with SQLITE_PATH below — reusing a dev server shares the wrong DB.
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          ...process.env,
          SQLITE_PATH: sqlitePath,
          BETTER_AUTH_SECRET:
            process.env.BETTER_AUTH_SECRET ??
            "e2e-secret-e2e-secret-e2e-secret-e2e-secret",
          BETTER_AUTH_URL: baseURL,
        },
      },
})
