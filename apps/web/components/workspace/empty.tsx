"use client"

import type { ProviderSummary } from "./types"

export function Empty({ providers }: { providers: ProviderSummary[] }) {
  return (
    <div className="grid min-h-[40vh] place-items-center text-center">
      <div className="max-w-sm">
        <h2 className="text-xl font-semibold tracking-tight">
          Write anything to begin
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Edits and regenerations become branches. Pick a model above if you
          need one.
        </p>
        {!providers.length && (
          <p className="mt-5 rounded-lg border border-dashed p-3 text-sm">
            Add your first provider in Settings to send.
          </p>
        )}
      </div>
    </div>
  )
}
