import { defineConfig } from "vitest/config"
import path from "node:path"
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
    setupFiles: ["./test/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
      "server-only": path.resolve(import.meta.dirname, "test/server-only.ts"),
    },
  },
})
