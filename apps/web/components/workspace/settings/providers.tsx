"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { useTRPC } from "@/lib/trpc-react"
import {
  asProviderKind,
  providerKindLabel,
  type ProviderKind,
} from "@/lib/provider-kinds"
import {
  catalogNameMap,
  defaultPdfInputForProviderKind,
  mergeCatalogWithSaved,
  modelsToPersist,
  parseProviderModelsJson,
  type CatalogModel,
  type ProviderModel,
} from "@/lib/provider-models"
import type { ProviderSummary } from "../types"
import { ProviderProfileFields } from "./provider-fields"
import { ProviderModelsEditor } from "./provider-models"

const emptyForm = {
  name: "",
  kind: "openai-compatible" as ProviderKind,
  baseUrl: "",
  apiKey: "",
  apiKeyEnv: "",
  clearApiKey: false,
}

export function ProviderSettings({
  providers,
  onSaved,
}: {
  providers: ProviderSummary[]
  onSaved: () => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [form, setForm] = useState(emptyForm)
  const [models, setModels] = useState<ProviderModel[]>([])
  const [catalog, setCatalog] = useState<CatalogModel[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)

  const handleCatalogChange = useCallback(
    (next: CatalogModel[]) => {
      setCatalog(next)
      setModels((current) =>
        mergeCatalogWithSaved(
          current,
          next,
          defaultPdfInputForProviderKind(form.kind)
        )
      )
    },
    [form.kind]
  )

  function resetEditor() {
    setForm(emptyForm)
    setModels([])
    setCatalog([])
    setEditingId(null)
  }

  const invalidateTitleModel = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.workspace.getSettings.queryKey(),
    })

  const createProvider = useMutation(
    trpc.workspace.createProvider.mutationOptions({
      onSuccess: (result) => {
        toast.success("Provider saved.")
        setForm((current) => ({ ...current, apiKey: "" }))
        setEditingId(result.id)
        onSaved()
      },
      onError: (error) => toast.error(error.message || "Could not save"),
    })
  )
  const updateProvider = useMutation(
    trpc.workspace.updateProvider.mutationOptions({
      onSuccess: () => {
        toast.success("Provider saved.")
        setForm((current) => ({ ...current, apiKey: "" }))
        void invalidateTitleModel()
        onSaved()
      },
      onError: (error) => toast.error(error.message || "Could not save"),
    })
  )
  const deleteProvider = useMutation(
    trpc.workspace.deleteProvider.mutationOptions({
      onSuccess: () => {
        toast.success("Provider deleted")
        void invalidateTitleModel()
        onSaved()
      },
      onError: (error) => toast.error(error.message || "Could not delete"),
    })
  )

  async function save() {
    const payload = {
      name: form.name,
      kind: form.kind,
      models: modelsToPersist(
        models,
        catalogNameMap(catalog),
        defaultPdfInputForProviderKind(form.kind)
      ),
      baseUrl: form.baseUrl,
      apiKey: form.apiKey || undefined,
      apiKeyEnv: form.apiKeyEnv || undefined,
      clearApiKey: form.clearApiKey || undefined,
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
          Connect an API, then choose which models appear in chats. Store a key
          here or name an environment variable.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ProviderProfileFields
          key={editingId ?? "new"}
          value={form}
          onChange={setForm}
          kindUi="select"
          existing={Boolean(editingId)}
          apiKeyLabel="Stored API key"
        >
          <ProviderModelsEditor
            providerId={editingId}
            models={models}
            catalog={catalog}
            defaultPdfInput={defaultPdfInputForProviderKind(form.kind)}
            onModelsChange={setModels}
            onCatalogChange={handleCatalogChange}
          />
        </ProviderProfileFields>
        <div className="flex gap-2">
          <Button onClick={() => void save()}>
            {editingId ? "Update provider" : "Save provider"}
          </Button>
          {editingId && (
            <Button variant="outline" onClick={resetEditor}>
              Cancel edit
            </Button>
          )}
        </div>
        <Separator />
        <div className="space-y-2">
          {providers.map((provider) => {
            const parsed = parseProviderModelsJson(provider.models_json)
            const enabled = parsed.filter((model) => model.enabled)
            return (
              <div
                key={provider.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <span className="font-medium">{provider.name}</span>
                  <Badge variant="secondary" className="ml-2">
                    {providerKindLabel(provider.kind)}
                  </Badge>
                  <p className="truncate text-xs text-muted-foreground">
                    {enabled.length
                      ? `${enabled.length} in chats${
                          enabled[0]
                            ? ` · ${enabled
                                .slice(0, 3)
                                .map((model) => model.label)
                                .join(", ")}${enabled.length > 3 ? "…" : ""}`
                            : ""
                        }`
                      : "no models enabled"}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingId(provider.id)
                      setCatalog([])
                      setModels(parsed)
                      setForm({
                        name: provider.name,
                        kind: asProviderKind(provider.kind),
                        baseUrl: provider.base_url ?? "",
                        apiKey: "",
                        apiKeyEnv: provider.api_key_env ?? "",
                        clearApiKey: false,
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
            )
          })}
          {!providers.length && (
            <p className="text-sm text-muted-foreground">No providers yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
