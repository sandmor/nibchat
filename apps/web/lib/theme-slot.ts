export const THEME_SLOT_LS_KEY = "nibchat.theme.slot"
export const MAGIC_RECENT_LS_KEY = "nibchat.appearance.recent-colors"

export type ThemeSlotMode = "system" | "light" | "dark"
export type ResolvedThemeSlot = "light" | "dark"

export function activeThemeId(input: {
  slot: ResolvedThemeSlot
  lightThemeId: string
  darkThemeId: string
}): string {
  return input.slot === "dark" ? input.darkThemeId : input.lightThemeId
}
