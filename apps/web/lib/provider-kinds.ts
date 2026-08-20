export const PROVIDER_KINDS = {
  openai: {
    label: "OpenAI",
    description: "Official API",
    name: "OpenAI",
  },
  anthropic: {
    label: "Anthropic",
    description: "Claude models",
    name: "Anthropic",
  },
  "openai-compatible": {
    label: "OpenAI-compatible",
    description: "OpenAI-style endpoint",
    name: "Compatible",
  },
} as const

export type ProviderKind = keyof typeof PROVIDER_KINDS

export const PROVIDER_KIND_ORDER = Object.keys(PROVIDER_KINDS) as ProviderKind[]

export const PROVIDER_KIND_LABELS = {
  openai: PROVIDER_KINDS.openai.label,
  anthropic: PROVIDER_KINDS.anthropic.label,
  "openai-compatible": PROVIDER_KINDS["openai-compatible"].label,
} satisfies Record<ProviderKind, string>

export function isProviderKind(value: string): value is ProviderKind {
  return Object.hasOwn(PROVIDER_KINDS, value)
}

export function asProviderKind(value: string): ProviderKind {
  return isProviderKind(value) ? value : "openai-compatible"
}

export function providerKindLabel(kind: string) {
  return isProviderKind(kind) ? PROVIDER_KINDS[kind].label : kind
}
