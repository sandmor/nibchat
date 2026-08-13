import { describe, expect, it } from "vitest"
import {
  catalogNameMap,
  firstEnabledModelId,
  mergeCatalogWithSaved,
  modelsToPersist,
  parseProviderModelsJson,
  providerModelsToJson,
  removeCustomModel,
  upsertCustomModel,
} from "@/lib/provider-models"

describe("provider model documents", () => {
  it("requires a versioned document and explicit provenance", () => {
    expect(parseProviderModelsJson('["gpt"]')).toEqual([])
    expect(
      parseProviderModelsJson(
        JSON.stringify({
          version: 1,
          preferences: [{ id: "gpt", enabled: true }],
        })
      )
    ).toEqual([])
    expect(
      parseProviderModelsJson(
        providerModelsToJson([
          { id: "gpt", label: "GPT", enabled: true, source: "catalog" },
        ])
      )
    ).toEqual([{ id: "gpt", label: "GPT", enabled: true, source: "catalog" }])
  })
})

describe("catalog synchronization", () => {
  it("prunes removed catalog models but retains custom models", () => {
    const next = mergeCatalogWithSaved(
      [
        { id: "removed", label: "Removed", enabled: true, source: "catalog" },
        { id: "kept", label: "My Kept", enabled: true, source: "catalog" },
        { id: "local", label: "Local", enabled: false, source: "custom" },
      ],
      [
        { id: "kept", name: "Kept" },
        { id: "new", name: "New" },
      ]
    )
    expect(next).toEqual([
      { id: "kept", label: "My Kept", enabled: true, source: "catalog" },
      { id: "local", label: "Local", enabled: false, source: "custom" },
      { id: "new", label: "New", enabled: false, source: "catalog" },
    ])
  })

  it("persists sparse catalog preferences and every custom entry", () => {
    expect(
      modelsToPersist(
        [
          { id: "on", label: "On", enabled: true, source: "catalog" },
          { id: "off", label: "Off", enabled: false, source: "catalog" },
          { id: "alias", label: "Alias", enabled: false, source: "catalog" },
          { id: "local", label: "Local", enabled: false, source: "custom" },
        ],
        catalogNameMap([
          { id: "on", name: "On" },
          { id: "off", name: "Off" },
          { id: "alias", name: "Original" },
        ])
      )
    ).toEqual([
      { id: "on", label: "On", enabled: true, source: "catalog" },
      { id: "alias", label: "Alias", enabled: false, source: "catalog" },
      { id: "local", label: "Local", enabled: false, source: "custom" },
    ])
  })

  it("does not let catalog membership change an explicit custom model", () => {
    const saved = [
      { id: "local", label: "Local", enabled: true, source: "custom" as const },
    ]
    expect(
      mergeCatalogWithSaved(saved, [{ id: "local", name: "Catalog Local" }])
    ).toEqual(saved)
    expect(removeCustomModel(saved, "local")).toEqual([])
  })

  it("adds and re-enables custom models", () => {
    const added = upsertCustomModel([], " local ")
    expect(added.models).toEqual([
      { id: "local", label: "local", enabled: true, source: "custom" },
    ])
    expect(firstEnabledModelId(added.models)).toBe("local")
  })
})
