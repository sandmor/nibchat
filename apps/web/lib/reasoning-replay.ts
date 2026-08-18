/** Whether reasoning parts are sent back to the model for this provider. */
export function replayReasoningEnabled(
  providerKind: string | undefined,
  replayReasoning: boolean | undefined
): boolean {
  if (!providerKind) return false
  return providerKind === "openai" || providerKind === "anthropic"
    ? replayReasoning !== false
    : replayReasoning === true
}
