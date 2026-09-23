"use client"

import type { ProviderSummary } from "../types"
import { ProviderSettings } from "./providers"
import { TitleModelSettings } from "./title-model"
import { PromptStackSettings } from "./prompt-stacks"
import { ContextBookSettings } from "./context-books"
import { ChatDefaultsSettings } from "./chat-defaults"
import { BuiltInToolsSettings } from "./builtin-tools"
import { PdfImageSettings } from "./pdf-images"
import { BackupSettings } from "./backup"
import { AppearanceSettings } from "./appearance"
import { McpSettings } from "./mcp"
import { UsersSettings } from "./users"
import { ConversationImportSettings } from "./conversation-import"
import { ChatTemplateSettings } from "./chat-templates"
import { ScheduleSettings } from "./schedules"

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
      <header className="shrink-0 border-b px-4 py-4 sm:px-5 sm:py-5">
        <p className="text-xs font-semibold tracking-[.18em] text-primary uppercase">
          {isOwner ? "Instance controls" : "Personal settings"}
        </p>
        <h1 className="mt-1 text-lg font-semibold text-pretty sm:text-xl">
          Workspace settings
        </h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div
          data-theme-group="settings"
          className="mx-auto grid max-w-4xl gap-6 p-4 sm:gap-7 sm:p-8"
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
          <ChatDefaultsSettings providers={providers} />
          <PdfImageSettings />
          <PromptStackSettings />
          <ContextBookSettings />
          <ChatTemplateSettings />
          <ScheduleSettings />
          <BuiltInToolsSettings />
          <ConversationImportSettings />
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
