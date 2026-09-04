"use client"

import { useState, type ReactNode } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  PROVIDER_KIND_LABELS,
  PROVIDER_KIND_ORDER,
  PROVIDER_KINDS,
  type ProviderKind,
} from "@/lib/provider-kinds"
import {
  OLLAMA_CLOUD_BASE_URL,
  OLLAMA_DEFAULT_BASE_URL,
  applyOllamaHostMode,
  isOllamaCloudUrl,
  isOllamaPresetUrl,
  type OllamaHostMode,
} from "@/lib/ollama"
import { defaultProviderHeaders } from "@/lib/provider-config"
import { cn } from "@/lib/utils"
import {
  KvEntriesEditor,
  type KvEntry,
} from "@/components/workspace/settings/kv-entries"

export type ProviderProfileFieldsValue = {
  name: string
  kind: ProviderKind
  baseUrl: string
  headers: KvEntry[]
}

export function ProviderProfileFields({
  value,
  onChange,
  kindUi,
  disabled = false,
  children,
}: {
  value: ProviderProfileFieldsValue
  onChange: (value: ProviderProfileFieldsValue) => void
  kindUi: "cards" | "select"
  disabled?: boolean
  children?: ReactNode
}) {
  const ollama = value.kind === "ollama"
  const [cloudChosen, setCloudChosen] = useState(() =>
    isOllamaCloudUrl(value.baseUrl)
  )
  const ollamaMode: OllamaHostMode =
    ollama && (cloudChosen || isOllamaCloudUrl(value.baseUrl))
      ? "cloud"
      : "local"
  const baseUrlPlaceholder = ollama
    ? ollamaMode === "cloud"
      ? OLLAMA_CLOUD_BASE_URL
      : OLLAMA_DEFAULT_BASE_URL
    : "https://your-endpoint/v1"
  const localHintId = "provider-base-url-hint"

  function patch(partial: Partial<ProviderProfileFieldsValue>) {
    onChange({ ...value, ...partial })
  }

  function setKind(next: ProviderKind) {
    if (next === value.kind) return
    const currentDefaults = defaultProviderHeaders(value.kind, {
      ollamaCloud: value.kind === "ollama" && isOllamaCloudUrl(value.baseUrl),
    })
    const nextBaseUrl =
      value.kind === "ollama" && isOllamaPresetUrl(value.baseUrl)
        ? ""
        : value.baseUrl
    setCloudChosen(next === "ollama" && isOllamaCloudUrl(value.baseUrl))
    patch({
      kind: next,
      baseUrl: nextBaseUrl,
      headers:
        value.headers.length === 0 ||
        sameHeaders(value.headers, currentDefaults)
          ? defaultProviderHeaders(next, {
              ollamaCloud: next === "ollama" && isOllamaCloudUrl(nextBaseUrl),
            })
          : value.headers,
    })
  }

  function setOllamaMode(mode: OllamaHostMode) {
    setCloudChosen(mode === "cloud")
    const leavingCloud = isOllamaCloudUrl(value.baseUrl) && mode === "local"
    const enteringCloud = mode === "cloud" && !isOllamaCloudUrl(value.baseUrl)
    patch({
      baseUrl: applyOllamaHostMode(value.baseUrl, mode),
      headers: leavingCloud
        ? value.headers.filter((header) => !isAuthorizationHeader(header))
        : enteringCloud && !value.headers.some(isAuthorizationHeader)
          ? [
              ...value.headers,
              ...defaultProviderHeaders("ollama", { ollamaCloud: true }),
            ]
          : value.headers,
    })
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {kindUi === "cards" ? (
        <fieldset className="grid gap-1.5 sm:col-span-2" disabled={disabled}>
          <legend className="mb-1 text-sm font-medium">Kind</legend>
          <div role="radiogroup" className="grid gap-1.5">
            {PROVIDER_KIND_ORDER.map((id) => {
              const item = PROVIDER_KINDS[id]
              const selected = value.kind === id
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setKind(id)}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-2xl border border-input bg-input/20 px-3 py-2 text-left text-sm transition-colors outline-none hover:bg-input/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    selected && "border-primary/40 bg-primary/10"
                  )}
                >
                  <span className="font-medium">{item.label}</span>
                  <span className="min-w-0 truncate text-right text-xs text-muted-foreground">
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
              setKind(next as ProviderKind)
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
      {ollama ? (
        <div className="grid gap-1.5 sm:col-span-2">
          <Label id="ollama-host-mode">Host</Label>
          <ToggleGroup
            value={[ollamaMode]}
            onValueChange={(next) => {
              const mode = next[0]
              if (mode === "local" || mode === "cloud") setOllamaMode(mode)
            }}
            disabled={disabled}
            variant="outline"
            spacing={0}
            size="sm"
            aria-labelledby="ollama-host-mode"
          >
            <ToggleGroupItem value="local">Local</ToggleGroupItem>
            <ToggleGroupItem value="cloud">Cloud</ToggleGroupItem>
          </ToggleGroup>
        </div>
      ) : null}
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="provider-base-url">Base URL</Label>
        {ollama && ollamaMode === "local" ? (
          <p
            id={localHintId}
            className="text-xs text-pretty text-muted-foreground"
          >
            Leave blank for the local default.
          </p>
        ) : null}
        <Input
          id="provider-base-url"
          value={value.baseUrl}
          onChange={(event) => patch({ baseUrl: event.target.value })}
          placeholder={baseUrlPlaceholder}
          disabled={disabled}
          aria-describedby={
            ollama && ollamaMode === "local" ? localHintId : undefined
          }
        />
      </div>
      <KvEntriesEditor
        label="Request headers"
        entries={value.headers}
        onChange={(headers) => patch({ headers })}
        namePlaceholder="Authorization"
        valuePlaceholder="Bearer ${PROVIDER_TOKEN}"
        addLabel="Add header"
        disabled={disabled}
      />
      {children}
    </div>
  )
}

function isAuthorizationHeader(header: KvEntry) {
  return header.name.toLowerCase() === "authorization"
}

function sameHeaders(left: KvEntry[], right: KvEntry[]) {
  return (
    left.length === right.length &&
    left.every(
      (header, index) =>
        header.name === right[index]?.name &&
        header.value === right[index]?.value
    )
  )
}
