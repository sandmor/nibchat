import { describe, expect, it } from "vitest"
import {
  clearCustomReasoning,
  hasCustomReasoning,
  nativeReasoningKind,
  reasoningRequest,
  reasoningSupport,
  selectedReasoning,
  withReasoning,
  type ReasoningSelection,
} from "./reasoning"
import {
  mergeCatalogWithSaved,
  modelsToPersist,
  parseProviderModelsJson,
  providerModelsToJson,
  type ProviderModel,
} from "./provider-models"

describe("reasoning configuration", () => {
  it("requires an explicit contract for a gateway, even with a familiar model id", () => {
    const kind = nativeReasoningKind("openai", "https://gateway.test/v1")
    expect(reasoningSupport(kind, "gpt-5.4")).toBeUndefined()
    expect(reasoningSupport("openai-compatible", "gpt-5.4")).toBeUndefined()
    expect(reasoningSupport("openai", "new-model")).toBeUndefined()
    expect(
      reasoningSupport("openai", "gpt-5.4", { format: "unsupported" })
    ).toEqual({ format: "unsupported" })
    expect(
      reasoningSupport(nativeReasoningKind("openai"), "gpt-5.4")
    ).toMatchObject({ format: "effort" })
  })

  it("round-trips disabled model overrides through sparse storage and catalog refresh", () => {
    const models: ProviderModel[] = [
      {
        id: "custom",
        label: "custom",
        source: "catalog",
        enabled: false,
        pdfInput: "extracted",
        reasoning: { format: "effort", levels: ["low", "high"] },
      },
    ]
    const stored = providerModelsToJson(
      modelsToPersist(
        models,
        new Map([["custom", "custom"]]),
        "extracted",
        true
      )
    )
    expect(
      mergeCatalogWithSaved(
        parseProviderModelsJson(stored),
        [{ id: "custom", name: "custom" }],
        "extracted"
      )
    ).toEqual(models)
  })

  it("remembers each provider/model independently and clears only the current choice", () => {
    const first = withReasoning(
      { providerId: "one", model: "shared" },
      { type: "effort", effort: "high" }
    )
    const second = withReasoning(
      { ...first, providerId: "two" },
      { type: "off" }
    )
    expect(selectedReasoning({ ...second, providerId: "one" })).toEqual({
      type: "effort",
      effort: "high",
    })
    expect(selectedReasoning({ ...second, model: "other" })).toBeUndefined()
    expect(selectedReasoning(withReasoning(second))).toBeUndefined()
    expect(
      selectedReasoning({ ...withReasoning(second), providerId: "one" })
    ).toEqual({ type: "effort", effort: "high" })
  })

  it("clears custom reasoning without losing unrelated provider options", () => {
    const options = {
      gateway: {
        reasoningEffort: "high",
        chat_template_kwargs: { enable_thinking: true, other: 42 },
        output_config: { effort: "high", format: "json" },
      },
      openai: { reasoningSummary: "auto" },
    }
    expect(hasCustomReasoning(options)).toBe(true)
    const cleared = clearCustomReasoning(options)
    expect(hasCustomReasoning(cleared)).toBe(false)
    expect(cleared).toEqual({
      gateway: {
        chat_template_kwargs: { other: 42 },
        output_config: { format: "json" },
      },
      openai: { reasoningSummary: "auto" },
    })
  })

  it("distinguishes Default, Off, effort, adaptive thinking and manual budgets", () => {
    const effort = { format: "effort" as const, levels: ["none", "high"] }
    expect(reasoningRequest(undefined, undefined, "responses").options).toEqual(
      {}
    )
    expect(
      reasoningRequest(effort, { type: "effort", effort: "none" }, "responses")
        .options
    ).toEqual({ reasoningEffort: "none" })
    expect(
      reasoningRequest(
        { format: "adaptive", levels: ["high"] },
        { type: "effort", effort: "high" },
        "anthropic"
      ).options
    ).toEqual({
      thinking: { type: "adaptive" },
      effort: "high",
    })
    expect(
      reasoningRequest(
        { format: "budget" },
        { type: "budget", tokens: 2048 },
        "anthropic",
        { maxOutputTokens: 4096 }
      ).options
    ).toEqual({ thinking: { type: "enabled", budgetTokens: 2048 } })
    expect(
      reasoningRequest({ format: "toggle" }, { type: "off" }, "chat").options
    ).toEqual({ reasoningEffort: "none" })
  })

  it("rejects stale levels, invalid budgets, sampling conflicts and incompatible formats", () => {
    const high: ReasoningSelection = { type: "effort", effort: "high" }
    expect(() => reasoningRequest(undefined, high, "chat")).toThrow(
      /Configure reasoning/
    )
    expect(() =>
      reasoningRequest({ format: "effort", levels: ["low"] }, high, "chat")
    ).toThrow(/no longer configured/)
    expect(() =>
      reasoningRequest({ format: "adaptive", levels: ["high"] }, high, "chat")
    ).toThrow(/Anthropic API/)
    expect(() =>
      reasoningRequest(
        { format: "adaptive", levels: ["high"] },
        high,
        "anthropic",
        { temperature: 0.7 }
      )
    ).toThrow(/Temperature/)
    for (const tokens of [512, 1024.5, 4096, 8192])
      expect(() =>
        reasoningRequest(
          { format: "budget" },
          { type: "budget", tokens },
          "anthropic",
          { maxOutputTokens: 4096 }
        )
      ).toThrow(/Thinking budget/)
  })
})
