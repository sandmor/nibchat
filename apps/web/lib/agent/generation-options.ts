import type { Parts } from "@/lib/types"

export type ToolPolicy = {
  question: boolean
  task: boolean
  mcp?: "inherit" | "none"
}

export type GenerationSettled = {
  outcome: "complete" | "awaiting_input" | "aborted" | "error"
  parts: Parts
}

export type AgentGenerationOptions = {
  maxSteps?: number
  toolPolicy?: ToolPolicy
  onLiveText?: (text: string) => void
  externalAbort?: AbortSignal
  whenSettled?: (result: GenerationSettled) => void
}
