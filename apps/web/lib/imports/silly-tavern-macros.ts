/** ST greeting/lore tokens for the imported character_name variable. */
export function rewriteSillyTavernMacros(text: string) {
  return text.replace(/\{\{\s*char(?:acter)?\s*\}\}/gi, "{{character_name}}")
}
