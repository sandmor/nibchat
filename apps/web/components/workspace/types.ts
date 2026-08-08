export type ProviderSummary = {
  id: string
  name: string
  kind: string
  base_url: string | null
  api_key_env: string | null
  models_json: string
  created_at: string
  updated_at: string
}

export type ModelConfigLocal = {
  providerId?: string
  model?: string
  temperature?: number
  maxOutputTokens?: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
  stopSequences?: string[]
  providerOptions?: Record<string, unknown>
  replayReasoning?: boolean
}

export type CatalogModel = { id: string; name: string }
