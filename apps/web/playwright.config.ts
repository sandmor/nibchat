import { defineConfig } from "@playwright/test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const e2eDataDir = mkdtempSync(path.join(tmpdir(), "vero-e2e-"))
const sqlitePath = path.join(e2eDataDir, "e2e.db")

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000"

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm dev --hostname 127.0.0.1 --port 3000",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
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
