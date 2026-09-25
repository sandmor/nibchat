const NAME_MACRO =
  /\{\{\s*(char(?:acter(?:_name)?)?|user(?:_name)?)\s*\}\}/gi

const SUPPORTED_MACRO =
  /^(?:char(?:acter(?:_name)?)?|user(?:_name)?|vars\.(?:character_name|user_name))$/i

/** ST name tokens become the prompt variables those names already use. */
export function rewriteSillyTavernMacros(text: string) {
  return text.replace(NAME_MACRO, (_match, name: string) =>
    name.toLowerCase().startsWith("user")
      ? "{{vars.user_name}}"
      : "{{vars.character_name}}"
  )
}

export function isSupportedSillyTavernMacro(macro: string) {
  return SUPPORTED_MACRO.test(macro.trim())
}
