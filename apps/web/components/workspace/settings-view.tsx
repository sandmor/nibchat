"use client"

import { useSearchParams } from "next/navigation"
import { SettingsPanel } from "./settings/panel"
import { useWorkspaceChrome } from "./shell"

export function SettingsView() {
  const { providers, refreshProviders, isOwner } = useWorkspaceChrome()
  const searchParams = useSearchParams()

  return (
    <SettingsPanel
      providers={providers}
      onProvidersChange={() => void refreshProviders()}
      isOwner={isOwner}
      activityChatId={searchParams.get("activityChat") ?? undefined}
    />
  )
}
