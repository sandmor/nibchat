"use client"

import { SettingsPanel } from "./settings/panel"
import { useWorkspaceChrome } from "./shell"

export function SettingsView() {
  const { appearance, setAppearance, providers, refreshProviders } =
    useWorkspaceChrome()

  return (
    <SettingsPanel
      providers={providers}
      appearance={appearance}
      onProvidersChange={() => void refreshProviders()}
      onAppearanceChange={setAppearance}
    />
  )
}
