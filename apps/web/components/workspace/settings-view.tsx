"use client"

import { SettingsPanel } from "./settings/panel"
import { useWorkspaceChrome } from "./shell"

export function SettingsView() {
  const { providers, refreshProviders, isOwner } = useWorkspaceChrome()

  return (
    <SettingsPanel
      providers={providers}
      onProvidersChange={() => void refreshProviders()}
      isOwner={isOwner}
    />
  )
}
