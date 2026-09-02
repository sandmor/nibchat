/** Whether reasoning parts are sent back to the model for this provider. */
export function replayReasoningEnabled(
  providerKind: string | undefined,
  replayReasoning: boolean | undefined
): boolean {
  if (!providerKind) return false
  return ["openai", "anthropic", "openai-compatible", "ollama"].includes(
    providerKind
  )
    ? replayReasoning !== false
    : replayReasoning === true
}
