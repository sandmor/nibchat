export type ProviderSummary = {
  id: string
  name: string
  kind: string
  reasoningKind: string | null
  config: {
    baseUrl?: string
    headers: Array<{ name: string; value: string }>
  }
  models_json: string
  created_at: string
  updated_at: string
}

export type { ModelConfig as ModelConfigLocal } from "@/lib/providers"

export type CatalogModel = { id: string; name: string }
