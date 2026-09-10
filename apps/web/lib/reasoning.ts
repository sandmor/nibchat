import { z } from "zod"

const levelsSchema = z.array(z.string().trim().min(1).max(32)).min(1).max(16)
export const reasoningSupportSchema = z.discriminatedUnion("format", [
  z.object({ format: z.literal("effort"), levels: levelsSchema }),
  z.object({ format: z.literal("adaptive"), levels: levelsSchema }),
  z.object({ format: z.literal("budget") }),
  z.object({ format: z.literal("toggle") }),
  z.object({ format: z.literal("custom") }),
  z.object({ format: z.literal("unsupported") }),
])
export type ReasoningSupport = z.infer<typeof reasoningSupportSchema>
const reasoningSelectionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("effort"), effort: z.string().min(1).max(32) }),
  z.object({ type: z.literal("budget"), tokens: z.number().int().min(1024) }),
  z.object({ type: z.literal("on") }),
  z.object({ type: z.literal("off") }),
])
export type ReasoningSelection = z.infer<typeof reasoningSelectionSchema>
export const reasoningPreferencesSchema = z.record(
  z.string().max(600),
  reasoningSelectionSchema
)
type ReasoningConfig = {
  providerId?: string
  model?: string
  reasoning?: Record<string, ReasoningSelection>
}

function reasoningKey(config: ReasoningConfig) {
  return JSON.stringify([config.providerId, config.model])
}
export function selectedReasoning(config: ReasoningConfig) {
  return config.reasoning?.[reasoningKey(config)]
}
export function withReasoning<T extends ReasoningConfig>(
  config: T,
  selection?: ReasoningSelection
): T {
  const reasoning = { ...config.reasoning }
  const key = reasoningKey(config)
  if (selection) reasoning[key] = selection
  else delete reasoning[key]
  return {
    ...config,
    reasoning: Object.keys(reasoning).length ? reasoning : undefined,
  }
}

/** Only recognized native hosts may use model-name defaults. Never infer a gateway's contract. */
export function nativeReasoningKind(kind: string, baseUrl?: string | null) {
  if (kind === "ollama") return kind
  if (kind !== "openai" && kind !== "anthropic") return undefined
  if (!baseUrl?.trim()) return kind
  try {
    const url = new URL(baseUrl)
    if (
      url.protocol === "https:" &&
      url.hostname ===
        (kind === "openai" ? "api.openai.com" : "api.anthropic.com")
    )
      return kind
  } catch {
    /* Unknown hosts require explicit configuration. */
  }
  return undefined
}

/** Small, conservative defaults; explicit model overrides handle aliases and new releases. */
export function reasoningSupport(
  kind: string | undefined,
  model: string,
  override?: ReasoningSupport
): ReasoningSupport | undefined {
  if (override) return override
  const id = model.replace(/-(?:\d{4}-\d{2}-\d{2}|\d{8})$/, "")
  const defaults: Array<[string, string[], ReasoningSupport]> = [
    [
      "openai",
      ["gpt-5", "gpt-5-mini", "gpt-5-nano"],
      { format: "effort", levels: ["minimal", "low", "medium", "high"] },
    ],
    [
      "openai",
      ["gpt-5.1"],
      { format: "effort", levels: ["none", "low", "medium", "high"] },
    ],
    [
      "openai",
      ["gpt-5.2", "gpt-5.4", "gpt-5.5"],
      { format: "effort", levels: ["none", "low", "medium", "high", "xhigh"] },
    ],
    [
      "openai",
      ["gpt-5.2-pro"],
      { format: "effort", levels: ["medium", "high", "xhigh"] },
    ],
    [
      "openai",
      ["gpt-5.4-pro", "gpt-5.5-pro"],
      { format: "effort", levels: ["medium", "high", "xhigh"] },
    ],
    [
      "openai",
      ["gpt-5-codex", "gpt-5.1-codex", "gpt-5.1-codex-mini"],
      { format: "effort", levels: ["low", "medium", "high"] },
    ],
    [
      "openai",
      ["gpt-5.1-codex-max", "gpt-5.2-codex"],
      { format: "effort", levels: ["low", "medium", "high", "xhigh"] },
    ],
    ["openai", ["gpt-5-pro"], { format: "effort", levels: ["high"] }],
    [
      "anthropic",
      ["claude-opus-4-7", "claude-opus-4-8", "claude-opus-5", "claude-sonnet-5"],
      {
        format: "adaptive",
        levels: ["none", "low", "medium", "high", "xhigh", "max"],
      },
    ],
    [
      "anthropic",
      [
        "claude-fable-5",
        "claude-mythos-5",
        "claude-fable-5.1",
        "claude-mythos-5.1",
      ],
      {
        format: "adaptive",
        levels: ["low", "medium", "high", "xhigh", "max"],
      },
    ],
    [
      "anthropic",
      ["claude-mythos-preview"],
      { format: "adaptive", levels: ["low", "medium", "high", "max"] },
    ],
    [
      "openai",
      ["gpt-6-astra"],
      { format: "effort", levels: ["low", "medium", "high", "xhigh", "max"] },
    ],
    [
      "openai",
      ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
      {
        format: "effort",
        levels: ["none", "low", "medium", "high", "xhigh", "max"],
      },
    ],
    [
      "openai",
      ["o3", "o3-mini", "o3-pro", "o4-mini"],
      { format: "effort", levels: ["low", "medium", "high"] },
    ],
    [
      "anthropic",
      ["claude-opus-4-6", "claude-sonnet-4-6"],
      { format: "adaptive", levels: ["none", "low", "medium", "high", "max"] },
    ],
    [
      "anthropic",
      [
        "claude-3-7-sonnet",
        "claude-sonnet-4",
        "claude-sonnet-4-5",
        "claude-opus-4",
        "claude-opus-4-1",
        "claude-opus-4-5",
        "claude-haiku-4-5",
      ],
      { format: "budget" },
    ],
  ]
  const known = defaults.find(
    ([provider, models]) => kind === provider && models.includes(id)
  )
  if (known) return known[2]
  if (kind === "ollama" && /^gpt-oss(?::|$)/.test(model))
    return { format: "effort", levels: ["low", "medium", "high"] }
  return undefined
}

const rawReasoningKeys = new Set([
  "reasoning",
  "reasoningEffort",
  "reasoning_effort",
  "thinking",
  "effort",
  "enable_thinking",
  "thinking_budget",
  "think",
])
export function hasCustomReasoning(options?: Record<string, unknown>): boolean {
  return Object.entries(options ?? {}).some(
    ([key, value]) =>
      rawReasoningKeys.has(key) ||
      (isRecord(value) && hasCustomReasoning(value))
  )
}
export function clearCustomReasoning(
  options?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!options) return undefined
  return Object.fromEntries(
    Object.entries(options)
      .filter(([key]) => !rawReasoningKeys.has(key))
      .map(([key, value]) => [
        key,
        isRecord(value) ? clearCustomReasoning(value) : value,
      ])
  )
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function reasoningLabel(selection?: ReasoningSelection) {
  if (!selection) return "Default"
  if (selection.type === "budget")
    return `${selection.tokens.toLocaleString("en-US")} tokens`
  if (selection.type === "effort")
    return selection.effort === "none"
      ? "Off"
      : selection.effort[0]!.toUpperCase() + selection.effort.slice(1)
  return selection.type === "on" ? "On" : "Off"
}

/** Validate a saved reasoning choice and translate it to provider SDK options. */
export function reasoningRequest(
  support: ReasoningSupport | undefined,
  selection: ReasoningSelection | undefined,
  protocol: "responses" | "chat" | "anthropic",
  limits: { maxOutputTokens?: number; temperature?: number; topP?: number } = {}
) {
  if (!selection) return { options: {} }
  if (
    !support ||
    support.format === "unsupported" ||
    support.format === "custom"
  )
    throw new Error(
      "Configure reasoning support for this model in Settings, or choose Default."
    )
  const anthropic = protocol === "anthropic"
  if (
    (support.format === "adaptive" || support.format === "budget") &&
    !anthropic
  )
    throw new Error(
      "This reasoning format requires the Anthropic API. Choose OpenAI effort for this endpoint."
    )
  let options: Record<string, unknown>
  if (support.format === "effort" || support.format === "adaptive") {
    if (
      selection.type !== "effort" ||
      !support.levels.includes(selection.effort)
    )
      throw new Error(
        "This reasoning level is no longer configured for the model. Choose a supported level or Default."
      )
    if (support.format === "effort") {
      if (anthropic)
        throw new Error(
          "Choose Adaptive thinking or Token budget for the Anthropic API."
        )
      options = { reasoningEffort: selection.effort }
    } else {
      const thinking = {
        type: selection.effort === "none" ? "disabled" : "adaptive",
      }
      options = {
        thinking,
        ...(selection.effort !== "none" ? { effort: selection.effort } : {}),
      }
    }
  } else if (support.format === "budget") {
    if (selection.type !== "budget" && selection.type !== "off")
      throw new Error("Choose a thinking token budget or Off for this model.")
    if (
      selection.type === "budget" &&
      (!Number.isInteger(selection.tokens) ||
        selection.tokens < 1024 ||
        (limits.maxOutputTokens !== undefined &&
          selection.tokens >= limits.maxOutputTokens))
    )
      throw new Error(
        "Thinking budget must be at least 1,024 tokens and smaller than Max output. Increase Max output or reduce the budget."
      )
    options = {
      thinking:
        selection.type === "off"
          ? { type: "disabled" }
          : { type: "enabled", budgetTokens: selection.tokens },
    }
  } else {
    if (anthropic || (selection.type !== "on" && selection.type !== "off"))
      throw new Error("Choose On or Off for this compatible endpoint.")
    const effort = selection.type === "on" ? "medium" : "none"
    options = { reasoningEffort: effort }
  }
  if (
    anthropic &&
    selection.type !== "off" &&
    !(selection.type === "effort" && selection.effort === "none") &&
    (limits.temperature !== undefined || limits.topP !== undefined)
  )
    throw new Error(
      "Clear Temperature and Top P in Parameters when using managed thinking."
    )
  return { options }
}
