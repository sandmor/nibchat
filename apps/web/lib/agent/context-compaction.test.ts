import { describe, expect, it, vi } from "vitest"
import type { ModelMessage } from "ai"
import { generateText } from "ai"
import {
  compactModelContext,
  contextCompactionRange,
} from "./context-compaction"

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: vi.fn(async () => ({ text: "Retained summary" })),
}))

describe("context compaction", () => {
  it("keeps short conversations intact and preserves recent turns in long ones", () => {
    const short: ModelMessage[] = Array.from({ length: 14 }, (_, index) => ({
      role: "user",
      content: `Message ${index}`,
    }))
    expect(contextCompactionRange(short)).toBeNull()

    const long: ModelMessage[] = Array.from({ length: 25 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      content: `${index}: ${"x".repeat(6_000)}`,
    }))
    const range = contextCompactionRange(long)
    expect(range).toBeTruthy()
    expect(range!.start).toBe(2)
    expect(range!.end).toBeLessThan(long.length - 7)
  })

  it("reuses a summary while the earlier range is unchanged", async () => {
    const messages: ModelMessage[] = Array.from({ length: 25 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      content: `${index}: ${"x".repeat(6_000)}`,
    }))
    const cache = { source: "", summary: "" }
    const input = {
      model: {} as Parameters<typeof compactModelContext>[0]["model"],
      messages,
      abortSignal: new AbortController().signal,
      cache,
    }
    const first = await compactModelContext(input)
    const calls = vi.mocked(generateText).mock.calls.length
    expect(calls).toBeGreaterThan(0)
    expect(await compactModelContext(input)).toEqual(first)
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(calls)

    const expanded: ModelMessage[] = [
      ...messages,
      ...Array.from({ length: 8 }, (_, index) => ({
        role: index % 2 ? ("assistant" as const) : ("user" as const),
        content: `Later ${index}: ${"y".repeat(6_000)}`,
      })),
    ]
    await compactModelContext({ ...input, messages: expanded })
    expect(vi.mocked(generateText).mock.calls.length).toBeGreaterThan(calls)
    expect(vi.mocked(generateText).mock.calls[calls]?.[0].prompt).toContain(
      "Summary so far:"
    )
  })
})
