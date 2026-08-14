"use client"

import { SettingsPanel } from "./settings/panel"
import { useWorkspaceChrome } from "./shell"

export function SettingsView() {
  const { providers, refreshProviders } = useWorkspaceChrome()

  return (
    <SettingsPanel
      providers={providers}
      onProvidersChange={() => void refreshProviders()}
    />
  )
}
