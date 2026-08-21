"use client"

import type { ProviderSummary } from "../types"
import { ProviderSettings } from "./providers"
import { TitleModelSettings } from "./title-model"
import { PromptStackSettings } from "./prompt-stacks"
import { BackupSettings } from "./backup"
import { AppearanceSettings } from "./appearance"
import { McpSettings } from "./mcp"
import { UsersSettings } from "./users"

export function SettingsPanel({
  providers,
  onProvidersChange,
  isOwner,
}: {
  providers: ProviderSummary[]
  onProvidersChange: () => void
  isOwner: boolean
}) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b px-5 py-5">
        <p className="text-xs font-semibold tracking-[.18em] text-primary uppercase">
          {isOwner ? "Instance controls" : "Personal settings"}
        </p>
        <h1 className="mt-1 text-xl font-semibold">
          {isOwner
            ? "Providers, MCP, prompts, appearance & users"
            : "Appearance & prompt stacks"}
        </h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div
          data-theme-group="settings"
          className="mx-auto grid max-w-4xl gap-7 p-5 sm:p-8"
        >
          {isOwner && (
            <>
              <ProviderSettings
                providers={providers}
                onSaved={onProvidersChange}
              />
              <TitleModelSettings providers={providers} />
              <McpSettings />
            </>
          )}
          <PromptStackSettings />
          {isOwner && (
            <>
              <BackupSettings />
              <UsersSettings />
            </>
          )}
          <AppearanceSettings />
        </div>
      </div>
    </section>
  )
}
