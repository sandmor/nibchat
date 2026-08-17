export type ProviderModelSource = "catalog" | "custom"

/** A user preference. Catalog entries are sparse; custom entries are always stored. */
export type ProviderModel = {
  id: string
  label: string
  enabled: boolean
  source: ProviderModelSource
}

export type ProviderModelDocument = {
  version: 1
  preferences: ProviderModel[]
}

export type CatalogModel = { id: string; name: string }
export type ModelVisibilityFilter = "all" | "on" | "off"

const MAX_MODEL_ID = 256
const MAX_MODEL_LABEL = 120

function trimId(value: unknown): string | null {
  if (typeof value !== "string") return null
  const id = value.trim()
  return id && id.length <= MAX_MODEL_ID ? id : null
}

function trimLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback
  const label = value.trim()
  return label ? label.slice(0, MAX_MODEL_LABEL) : fallback
}

/** Strict parser: alpha data must state where every preference originated. */
export function parseProviderModels(raw: unknown): ProviderModel[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const models: ProviderModel[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const record = item as {
      id?: unknown
      label?: unknown
      enabled?: unknown
      source?: unknown
    }
    const id = trimId(record.id)
    if (
      !id ||
      seen.has(id) ||
      (record.source !== "catalog" && record.source !== "custom")
    )
      continue
    seen.add(id)
    models.push({
      id,
      label: trimLabel(record.label, id),
      enabled: record.enabled === true,
      source: record.source,
    })
  }
  return models
}

export function parseProviderModelsJson(json: string): ProviderModel[] {
  try {
    const document = JSON.parse(json) as Partial<ProviderModelDocument>
    if (!document || document.version !== 1) return []
    return parseProviderModels(document.preferences)
  } catch {
    return []
  }
}

export function isProviderModelsJson(json: string): boolean {
  try {
    const document = JSON.parse(json) as Partial<ProviderModelDocument>
    return (
      document?.version === 1 &&
      Array.isArray(document.preferences) &&
      parseProviderModels(document.preferences).length ===
        document.preferences.length
    )
  } catch {
    return false
  }
}

export function providerModelsToJson(models: ProviderModel[]): string {
  return JSON.stringify({
    version: 1,
    preferences: parseProviderModels(models),
  })
}

export function defaultModelLabel(id: string, catalogName?: string) {
  return catalogName?.trim() || id
}

export function firstEnabledModelId(models: ProviderModel[]) {
  return models.find((model) => model.enabled)?.id
}

export function isEnabledModelId(models: ProviderModel[], modelId: string) {
  return models.some((model) => model.enabled && model.id === modelId)
}

export function resolveModelLabel(models: ProviderModel[], modelId?: string) {
  if (!modelId) return undefined
  return models.find((model) => model.id === modelId)?.label ?? modelId
}

export function pickerModels(models: ProviderModel[]): CatalogModel[] {
  return models
    .filter((model) => model.enabled)
    .map(({ id, label }) => ({ id, name: label }))
}

export function catalogNameMap(catalog: CatalogModel[]) {
  const map = new Map<string, string>()
  for (const entry of catalog) {
    const id = trimId(entry.id)
    if (id) map.set(id, defaultModelLabel(id, entry.name))
  }
  return map
}

/**
 * Materialize the editor from sparse preferences and an authoritative catalog.
 * A successful refresh intentionally drops catalog rows no longer supplied.
 */
export function mergeCatalogWithSaved(
  saved: ProviderModel[],
  catalog: CatalogModel[]
): ProviderModel[] {
  const catalogNames = catalogNameMap(catalog)
  const result: ProviderModel[] = []
  const seen = new Set<string>()
  for (const model of saved) {
    if (seen.has(model.id)) continue
    if (model.source === "catalog" && !catalogNames.has(model.id)) continue
    seen.add(model.id)
    result.push(model)
  }
  for (const [id, name] of catalogNames) {
    if (seen.has(id)) continue
    seen.add(id)
    result.push({ id, label: name, enabled: false, source: "catalog" })
  }
  return result
}

/** Persist sparse catalog preferences while retaining every explicit custom model. */
export function modelsToPersist(
  models: ProviderModel[],
  catalogNames: ReadonlyMap<string, string>
): ProviderModel[] {
  return models
    .filter((model) => {
      if (model.source === "custom") return true
      if (!catalogNames.has(model.id)) return false
      return model.enabled || model.label !== catalogNames.get(model.id)
    })
    .map((model) => ({ ...model, label: trimLabel(model.label, model.id) }))
}

export function filterProviderModels(
  models: ProviderModel[],
  query: string,
  visibility: ModelVisibilityFilter
) {
  const q = query.trim().toLowerCase()
  return models.filter((model) => {
    if (visibility === "on" && !model.enabled) return false
    if (visibility === "off" && model.enabled) return false
    return (
      !q ||
      model.id.toLowerCase().includes(q) ||
      model.label.toLowerCase().includes(q)
    )
  })
}

export function setModelsEnabled(
  models: ProviderModel[],
  ids: ReadonlySet<string>,
  enabled: boolean
) {
  return ids.size
    ? models.map((model) => (ids.has(model.id) ? { ...model, enabled } : model))
    : models
}

export function upsertCustomModel(
  models: ProviderModel[],
  rawId: string
): { models: ProviderModel[]; status: "added" | "enabled" | "exists" } {
  const id = trimId(rawId)
  if (!id) return { models, status: "exists" }
  const index = models.findIndex((model) => model.id === id)
  if (index === -1)
    return {
      status: "added",
      models: [{ id, label: id, enabled: true, source: "custom" }, ...models],
    }
  if (models[index]!.enabled) return { models, status: "exists" }
  const next = [...models]
  next[index] = { ...next[index]!, enabled: true }
  return { models: next, status: "enabled" }
}

export function removeCustomModel(models: ProviderModel[], id: string) {
  return models.filter((model) => model.id !== id || model.source !== "custom")
}
