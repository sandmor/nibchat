import { describe, expect, it } from "vitest"
import { replayReasoningEnabled } from "@/lib/reasoning-replay"

describe("replayReasoningEnabled", () => {
  it("defaults on for openai and anthropic", () => {
    expect(replayReasoningEnabled("openai", undefined)).toBe(true)
    expect(replayReasoningEnabled("anthropic", undefined)).toBe(true)
    expect(replayReasoningEnabled("openai", false)).toBe(false)
  })

  it("defaults off for compatible endpoints", () => {
    expect(replayReasoningEnabled("openai-compatible", undefined)).toBe(false)
    expect(replayReasoningEnabled("openai-compatible", true)).toBe(true)
    expect(replayReasoningEnabled("ollama", undefined)).toBe(false)
    expect(replayReasoningEnabled("ollama", true)).toBe(true)
  })

  it("is off without a provider", () => {
    expect(replayReasoningEnabled(undefined, true)).toBe(false)
  })
})
