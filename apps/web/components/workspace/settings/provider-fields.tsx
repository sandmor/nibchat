"use client"

import type { ReactNode } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Tick02Icon } from "@hugeicons/core-free-icons"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  PROVIDER_KIND_LABELS,
  PROVIDER_KIND_ORDER,
  PROVIDER_KINDS,
  type ProviderKind,
} from "@/lib/provider-kinds"
import { cn } from "@/lib/utils"

export type ProviderProfileFieldsValue = {
  name: string
  kind: ProviderKind
  baseUrl: string
  apiKey: string
  apiKeyEnv: string
}

export function ProviderProfileFields({
  value,
  onChange,
  kindUi,
  existing = false,
  disabled = false,
  apiKeyLabel = "API key",
  children,
}: {
  value: ProviderProfileFieldsValue
  onChange: (value: ProviderProfileFieldsValue) => void
  kindUi: "cards" | "select"
  existing?: boolean
  disabled?: boolean
  apiKeyLabel?: string
  children?: ReactNode
}) {
  function patch(partial: Partial<ProviderProfileFieldsValue>) {
    onChange({ ...value, ...partial })
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {kindUi === "cards" ? (
        <fieldset className="grid gap-2 sm:col-span-2" disabled={disabled}>
          <legend className="mb-1 text-sm font-medium">Kind</legend>
          <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
            {PROVIDER_KIND_ORDER.map((id) => {
              const item = PROVIDER_KINDS[id]
              const selected = value.kind === id
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => patch({ kind: id })}
                  className={cn(
                    "relative flex min-h-11 flex-col gap-0.5 rounded-2xl border border-input bg-input/20 px-3 py-3 text-left text-sm transition-colors outline-none hover:bg-input/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    selected && "border-primary/40 bg-primary/10"
                  )}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-full border border-input-border",
                        selected &&
                          "border-primary bg-primary text-primary-foreground"
                      )}
                    >
                      {selected ? (
                        <HugeiconsIcon
                          icon={Tick02Icon}
                          strokeWidth={2}
                          className="size-3"
                        />
                      ) : null}
                    </span>
                    {item.label}
                  </span>
                  <span className="pl-6 text-xs text-muted-foreground">
                    {item.description}
                  </span>
                </button>
              )
            })}
          </div>
        </fieldset>
      ) : null}
      <div
        className={cn("grid gap-1.5", kindUi === "cards" && "sm:col-span-2")}
      >
        <Label htmlFor="provider-name">Display name</Label>
        <Input
          id="provider-name"
          value={value.name}
          onChange={(event) => patch({ name: event.target.value })}
          disabled={disabled}
        />
      </div>
      {kindUi === "select" ? (
        <div className="grid gap-1.5">
          <Label htmlFor="provider-kind">Kind</Label>
          <Select
            value={value.kind}
            items={PROVIDER_KIND_LABELS}
            onValueChange={(next) => {
              if (next == null) return
              patch({ kind: next as ProviderKind })
            }}
            disabled={disabled}
          >
            <SelectTrigger id="provider-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_KIND_ORDER.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {PROVIDER_KINDS[kind].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="provider-base-url">Base URL</Label>
        <Input
          id="provider-base-url"
          value={value.baseUrl}
          onChange={(event) => patch({ baseUrl: event.target.value })}
          placeholder="https://your-endpoint/v1"
          disabled={disabled}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="provider-api-key">{apiKeyLabel}</Label>
        <Input
          id="provider-api-key"
          type="password"
          value={value.apiKey}
          onChange={(event) => patch({ apiKey: event.target.value })}
          autoComplete="off"
          placeholder={existing ? "Leave blank to keep existing" : undefined}
          disabled={disabled}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="provider-api-key-env">Or environment variable</Label>
        <Input
          id="provider-api-key-env"
          value={value.apiKeyEnv}
          onChange={(event) => patch({ apiKeyEnv: event.target.value })}
          placeholder="OPENAI_API_KEY"
          disabled={disabled}
        />
      </div>
      {children}
    </div>
  )
}
