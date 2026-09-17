import { describe, expect, it } from "vitest"
import { providerModelsToJson } from "@/lib/provider-models"
import {
  accumulateGenerationMs,
  effectiveMessageStatus,
  formatGenerationDuration,
  formatMessageTime,
  generationDurationMs,
  joinMessageMeta,
  messageOriginLabel,
  messageStatusLabel,
  resolveMessageOrigin,
} from "@/lib/message-meta"

describe("generation duration", () => {
  it("accumulates the open segment onto earlier paused time", () => {
    expect(accumulateGenerationMs({}, "2026-01-01T00:00:02.000Z")).toBeNull()
    expect(
      accumulateGenerationMs(
        { startedAt: "2026-01-01T00:00:00.000Z" },
        "2026-01-01T00:00:02.500Z"
      )
    ).toBe(2500)
    expect(
      accumulateGenerationMs(
        { startedAt: "2026-01-01T00:00:00.000Z", generationMs: 1_000 },
        "2026-01-01T00:00:02.000Z"
      )
    ).toBe(3_000)
  })

  it("prefers stored duration and otherwise falls back to terminal timestamps", () => {
    expect(
      generationDurationMs({
        generationMs: 4_200,
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
      })
    ).toBe(4_200)
    expect(
      generationDurationMs({
        startedAt: "2026-01-01T00:00:00.000Z",
        errorAt: "2026-01-01T00:00:01.250Z",
      })
    ).toBe(1_250)
    expect(
      generationDurationMs({
        startedAt: "2026-01-01T00:00:02.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
      })
    ).toBeNull()
  })

  it("formats compact durations", () => {
    expect(formatGenerationDuration(1)).toBe("1ms")
    expect(formatGenerationDuration(1_500)).toBe("1.5s")
    expect(formatGenerationDuration(12_400)).toBe("12s")
    expect(formatGenerationDuration(60_000)).toBe("1m")
    expect(formatGenerationDuration(61_000)).toBe("1m 1s")
    expect(formatGenerationDuration(119_500)).toBe("2m")
  })
})

describe("message status", () => {
  it("treats a live overlay on a completed row as still streaming", () => {
    expect(effectiveMessageStatus("complete", true)).toBe("streaming")
    expect(effectiveMessageStatus("error", true)).toBe("error")
    expect(effectiveMessageStatus("complete", false)).toBe("complete")
  })

  it("hides the complete label", () => {
    expect(messageStatusLabel("complete")).toBeNull()
    expect(messageStatusLabel("awaiting_input")).toBe("waiting for input")
    expect(messageStatusLabel("streaming")).toBe("streaming")
  })
})

describe("message time and origin", () => {
  it("joins only present fragments", () => {
    expect(joinMessageMeta("3:04 PM", null, "Opus")).toBe("3:04 PM, Opus")
    expect(joinMessageMeta(undefined, "")).toBe("")
  })

  it("compacts today's time and keeps older dates", () => {
    const now = new Date("2026-09-17T18:00:00.000Z")
    const options = { now, locale: "en-US", timeZone: "UTC" }
    const today = formatMessageTime("2026-09-17T15:04:00.000Z", options)
    expect(today?.compact).toMatch(/3:04/)
    expect(today?.compact).not.toMatch(/Sep/)
    const earlier = formatMessageTime("2026-09-16T15:04:00.000Z", options)
    expect(earlier?.compact).toMatch(/Sep 16/)
    expect(earlier?.compact).not.toMatch(/2026/)
    const lastYear = formatMessageTime("2025-09-17T15:04:00.000Z", options)
    expect(lastYear?.compact).toMatch(/2025/)
    expect(formatMessageTime("not a date")).toBeNull()
  })

  it("resolves live providers and imported sources", () => {
    const providers = [
      {
        id: "openai",
        name: "OpenAI",
        models_json: providerModelsToJson([
          {
            id: "gpt-5",
            label: "GPT-5",
            enabled: true,
            source: "catalog",
            pdfInput: "native",
          },
        ]),
      },
    ]
    expect(
      resolveMessageOrigin({ provider: "openai", model: "gpt-5" }, providers)
    ).toEqual({
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
    })
    expect(
      resolveMessageOrigin(
        { import: { source: "chatgpt", sourceModel: "gpt-4o" } },
        []
      )
    ).toEqual({
      providerId: null,
      providerName: "ChatGPT",
      modelId: "gpt-4o",
      modelName: "gpt-4o",
    })
    expect(
      messageOriginLabel({
        providerId: "openai",
        providerName: "OpenAI",
        modelId: "gpt-5",
        modelName: "GPT-5",
      })
    ).toBe("OpenAI, GPT-5")
  })
})
