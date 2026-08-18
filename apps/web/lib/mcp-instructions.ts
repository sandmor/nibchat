/**
 * Optional system prose from MCP initialize instructions only.
 * Resources/prompts are not ambient context — open them via chat attach/insert.
 */
export function buildMcpInstructionsText(
  profiles: Array<{ name: string; instructions?: string | null }>
): string {
  const blocks: string[] = []
  for (const profile of profiles) {
    const instructions = profile.instructions?.trim()
    if (!instructions) continue
    blocks.push(`MCP server “${profile.name}”:\n${instructions}`)
  }
  return blocks.join("\n\n")
}
