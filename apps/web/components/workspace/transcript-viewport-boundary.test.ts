import { fileURLToPath } from "node:url"
import { ESLint } from "eslint"
import { expect, it } from "vitest"

it("enforces the pure viewport boundary even with the repository's warning-only lint setup", async () => {
  const eslint = new ESLint({
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
  })
  const filePath = "components/workspace/transcript-viewport-model.ts"
  const [source] = await eslint.lintFiles([filePath])
  expect(source!.messages).toEqual([])
  // Verify the actual scoped configuration, not a second copy of its rules.
  for (const [code, rule] of [
    [
      'import { useState } from "react"\nexport const forbidden = useState',
      "no-restricted-imports",
    ],
    ["export const forbidden = window.scrollY", "no-restricted-globals"],
  ]) {
    const [result] = await eslint.lintText(code!, { filePath })
    expect(result!.messages.some((message) => message.ruleId === rule)).toBe(
      true
    )
  }
}, 15_000)
