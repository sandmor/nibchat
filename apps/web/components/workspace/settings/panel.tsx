"use client"

import type { ResolvedAppearance } from "@/lib/appearance"
import type { ProviderSummary } from "../types"
import { ProviderSettings } from "./providers"
import { PromptStackSettings } from "./prompt-stacks"
import { BackupSettings } from "./backup"
import { AppearanceSettings } from "./appearance"

export function SettingsPanel({
  providers,
  appearance,
  onProvidersChange,
  onAppearanceChange,
}: {
  providers: ProviderSummary[]
  appearance: ResolvedAppearance
  onProvidersChange: () => void
  onAppearanceChange: (next: ResolvedAppearance) => void
}) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b px-5 py-5">
        <p className="text-xs font-semibold tracking-[.18em] text-primary uppercase">
          Instance controls
        </p>
        <h1 className="mt-1 text-xl font-semibold">
          Providers, prompts & appearance
        </h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto grid max-w-4xl gap-7 p-5 sm:p-8">
          <ProviderSettings providers={providers} onSaved={onProvidersChange} />
          <PromptStackSettings />
          <BackupSettings />
          <AppearanceSettings
            appearance={appearance}
            onChange={onAppearanceChange}
          />
        </div>
      </div>
    </section>
  )
}
