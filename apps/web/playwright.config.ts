import { defineConfig } from "@playwright/test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const e2eDataDir = mkdtempSync(path.join(tmpdir(), "nibchat-e2e-"))
const sqlitePath = path.join(e2eDataDir, "e2e.db")

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3456"

const webServer = process.env.E2E_BASE_URL
  ? undefined
  : {
      command: "pnpm dev --hostname 127.0.0.1 --port 3456",
      url: baseURL,
      // Always boot with SQLITE_PATH below — reusing a dev server shares the wrong DB.
      reuseExistingServer: false,
      timeout: 120_000,
      // Dev server + browser console chatter (HMR, motion, better-auth) drowns failures.
      stdout: "ignore" as const,
      stderr: "pipe" as const,
      env: {
        ...process.env,
        SQLITE_PATH: sqlitePath,
        BETTER_AUTH_SECRET:
          process.env.BETTER_AUTH_SECRET ??
          "e2e-secret-e2e-secret-e2e-secret-e2e-secret",
        BETTER_AUTH_URL: baseURL,
      },
    }

export default defineConfig({
  testDir: "./e2e",
  // Shared SQLite instance: one worker per project.
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: { baseURL },
  webServer,
  // owner-flow requires an unclaimed instance; other suites call ensureWorkspace
  // (login or claim) and share the same DB + mock provider profile.
  projects: [
    {
      name: "owner",
      testMatch: /owner-flow\.spec\.ts/,
    },
    {
      name: "workspace",
      dependencies: ["owner"],
      testIgnore: /owner-flow\.spec\.ts/,
    },
  ],
})
