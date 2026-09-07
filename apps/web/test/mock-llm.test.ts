import { expect, test } from "vitest"
import { startMockLlm } from "../e2e/helpers/mock-llm"

test("closing the mock server terminates a held completion", async () => {
  const llm = await startMockLlm()
  llm.enqueue({ text: "held reply", hold: true })
  const response = await fetch(`${llm.baseUrl}/chat/completions`, {
    method: "POST",
    body: JSON.stringify({ stream: true }),
  })
  const body = response.text().catch(() => {})
  const closing = llm.close()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      closing.then(() => "closed"),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve("still waiting"), 500)
      }),
    ])
    expect(result).toBe("closed")
  } finally {
    clearTimeout(timer)
    llm.release()
    await body
    await closing
  }
})
