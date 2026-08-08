"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useMutation } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { useTRPC } from "@/lib/trpc-react"
import { parseJson } from "@/lib/domain"
import type { ProviderSummary } from "../types"

const PROVIDER_KIND_ITEMS = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  "openai-compatible": "OpenAI-compatible",
} as const

type ProviderKind = keyof typeof PROVIDER_KIND_ITEMS

function kindLabel(kind: string) {
  return PROVIDER_KIND_ITEMS[kind as ProviderKind] ?? kind
}

export function ProviderSettings({
  providers,
  onSaved,
}: {
  providers: ProviderSummary[]
  onSaved: () => void
}) {
  const trpc = useTRPC()
  const empty = {
    name: "",
    kind: "openai-compatible" as ProviderKind,
    models: "",
    baseUrl: "",
    apiKey: "",
    apiKeyEnv: "",
  }
  const [form, setForm] = useState(empty)
  const [editingId, setEditingId] = useState<string | null>(null)

  const createProvider = useMutation(
    trpc.workspace.createProvider.mutationOptions({
      onSuccess: () => {
        toast.success(
          "Provider saved. Secrets remain server-only and are excluded from exports."
        )
        setForm(empty)
        setEditingId(null)
        onSaved()
      },
      onError: (error) => toast.error(error.message || "Could not save"),
    })
  )
  const updateProvider = useMutation(
    trpc.workspace.updateProvider.mutationOptions({
      onSuccess: () => {
        toast.success(
          "Provider saved. Secrets remain server-only and are excluded from exports."
        )
        setForm(empty)
        setEditingId(null)
        onSaved()
      },
      onError: (error) => toast.error(error.message || "Could not save"),
    })
  )
  const deleteProvider = useMutation(
    trpc.workspace.deleteProvider.mutationOptions({
      onSuccess: () => {
        toast.success("Provider deleted")
        onSaved()
      },
      onError: (error) => toast.error(error.message || "Could not delete"),
    })
  )

  async function save() {
    const payload = {
      name: form.name,
      kind: form.kind,
      models: form.models
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      baseUrl: form.baseUrl,
      apiKey: form.apiKey || undefined,
      apiKeyEnv: form.apiKeyEnv || undefined,
    }
    if (editingId)
      await updateProvider.mutateAsync({ id: editingId, ...payload })
    else await createProvider.mutateAsync(payload)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model providers</CardTitle>
        <CardDescription>
          Native OpenAI and Anthropic, plus any OpenAI-compatible endpoint. A
          key may be stored here or read from any environment variable.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Display name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Kind</Label>
            <Select
              value={form.kind}
              items={PROVIDER_KIND_ITEMS}
              onValueChange={(value) => {
                if (value == null) return
                setForm({
                  ...form,
                  kind: value as ProviderKind,
                })
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PROVIDER_KIND_ITEMS) as ProviderKind[]).map(
                  (kind) => (
                    <SelectItem key={kind} value={kind}>
                      {PROVIDER_KIND_ITEMS[kind]}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Models (comma-separated)</Label>
            <Input
              value={form.models}
              onChange={(e) => setForm({ ...form, models: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Base URL</Label>
            <Input
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="For compatible endpoints"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Stored API key</Label>
            <Input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder={
                editingId ? "Leave blank to keep existing" : undefined
              }
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Or environment variable</Label>
            <Input
              value={form.apiKeyEnv}
              onChange={(e) => setForm({ ...form, apiKeyEnv: e.target.value })}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={save}>
            {editingId ? "Update provider" : "Save provider"}
          </Button>
          {editingId && (
            <Button
              variant="outline"
              onClick={() => {
                setEditingId(null)
                setForm(empty)
              }}
            >
              Cancel edit
            </Button>
          )}
        </div>
        <Separator />
        <div className="space-y-2">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <span className="font-medium">{provider.name}</span>
                <Badge variant="secondary" className="ml-2">
                  {kindLabel(provider.kind)}
                </Badge>
                <p className="truncate text-xs text-muted-foreground">
                  {parseJson<string[]>(provider.models_json, []).join(", ") ||
                    "manual model entry"}
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingId(provider.id)
                    setForm({
                      name: provider.name,
                      kind: (provider.kind in PROVIDER_KIND_ITEMS
                        ? provider.kind
                        : "openai-compatible") as ProviderKind,
                      models: parseJson<string[]>(
                        provider.models_json,
                        []
                      ).join(", "),
                      baseUrl: provider.base_url ?? "",
                      apiKey: "",
                      apiKeyEnv: provider.api_key_env ?? "",
                    })
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() =>
                    deleteProvider.mutate({
                      id: provider.id,
                    })
                  }
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
          {!providers.length && (
            <p className="text-sm text-muted-foreground">No providers yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
