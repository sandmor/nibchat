export type SettingsSectionId =
  | "chat"
  | "libraries"
  | "connections"
  | "appearance"
  | "activity"
  | "instance"

export type SettingsSection = {
  id: SettingsSectionId
  label: string
  /** Hidden from people who do not own the instance. */
  ownerOnly?: boolean
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "chat", label: "Chat" },
  { id: "libraries", label: "Libraries" },
  { id: "connections", label: "Connections", ownerOnly: true },
  { id: "appearance", label: "Appearance" },
  { id: "activity", label: "Activity" },
  { id: "instance", label: "Instance" },
]

const CARD_SECTION: Partial<Record<string, SettingsSectionId>> = {
  "chat-templates": "libraries",
}

export function visibleSettingsSections(isOwner: boolean) {
  return SETTINGS_SECTIONS.filter((section) => isOwner || !section.ownerOnly)
}

export function sectionIdForHash(
  hash: string,
  isOwner: boolean
): SettingsSectionId {
  const id = hash.slice(1)
  const candidate = CARD_SECTION[id] ?? id
  const match = visibleSettingsSections(isOwner).find(
    (section) => section.id === candidate
  )
  return match?.id ?? "chat"
}
