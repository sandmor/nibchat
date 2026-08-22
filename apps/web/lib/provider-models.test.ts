import { describe, expect, it } from "vitest"
import {
  catalogNameMap,
  firstEnabledModelId,
  isEnabledModelId,
  mergeCatalogWithSaved,
  modelsToPersist,
  parseProviderCatalogPayload,
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
          {
            id: "gpt",
            label: "GPT",
            enabled: true,
            source: "catalog",
            pdfInput: "native",
          },
        ])
      )
    ).toEqual([
      {
        id: "gpt",
        label: "GPT",
        enabled: true,
        source: "catalog",
        pdfInput: "native",
      },
    ])
  })
})

describe("catalog synchronization", () => {
  it("prunes removed catalog models but retains custom models", () => {
    const next = mergeCatalogWithSaved(
      [
        {
          id: "removed",
          label: "Removed",
          enabled: true,
          source: "catalog",
          pdfInput: "native",
        },
        {
          id: "kept",
          label: "My Kept",
          enabled: true,
          source: "catalog",
          pdfInput: "native",
        },
        {
          id: "local",
          label: "Local",
          enabled: false,
          source: "custom",
          pdfInput: "native",
        },
      ],
      [
        { id: "kept", name: "Kept" },
        { id: "new", name: "New" },
      ],
      "native"
    )
    expect(next).toEqual([
      {
        id: "kept",
        label: "My Kept",
        enabled: true,
        source: "catalog",
        pdfInput: "native",
      },
      {
        id: "local",
        label: "Local",
        enabled: false,
        source: "custom",
        pdfInput: "native",
      },
      {
        id: "new",
        label: "New",
        enabled: false,
        source: "catalog",
        pdfInput: "native",
      },
    ])
  })

  it("persists sparse catalog preferences and every custom entry", () => {
    expect(
      modelsToPersist(
        [
          {
            id: "on",
            label: "On",
            enabled: true,
            source: "catalog",
            pdfInput: "native",
          },
          {
            id: "off",
            label: "Off",
            enabled: false,
            source: "catalog",
            pdfInput: "native",
          },
          {
            id: "alias",
            label: "Alias",
            enabled: false,
            source: "catalog",
            pdfInput: "native",
          },
          {
            id: "local",
            label: "Local",
            enabled: false,
            source: "custom",
            pdfInput: "native",
          },
        ],
        catalogNameMap([
          { id: "on", name: "On" },
          { id: "off", name: "Off" },
          { id: "alias", name: "Original" },
        ]),
        "native"
      )
    ).toEqual([
      {
        id: "on",
        label: "On",
        enabled: true,
        source: "catalog",
        pdfInput: "native",
      },
      {
        id: "alias",
        label: "Alias",
        enabled: false,
        source: "catalog",
        pdfInput: "native",
      },
      {
        id: "local",
        label: "Local",
        enabled: false,
        source: "custom",
        pdfInput: "native",
      },
    ])
  })

  it("persists a catalog PDF-mode override even when the model is off", () => {
    expect(
      modelsToPersist(
        [
          {
            id: "off",
            label: "Off",
            enabled: false,
            source: "catalog",
            pdfInput: "extracted",
          },
        ],
        catalogNameMap([{ id: "off", name: "Off" }]),
        "native"
      )
    ).toEqual([
      {
        id: "off",
        label: "Off",
        enabled: false,
        source: "catalog",
        pdfInput: "extracted",
      },
    ])
  })

  it("does not let catalog membership change an explicit custom model", () => {
    const saved = [
      {
        id: "local",
        label: "Local",
        enabled: true,
        source: "custom" as const,
        pdfInput: "native" as const,
      },
    ]
    expect(
      mergeCatalogWithSaved(
        saved,
        [{ id: "local", name: "Catalog Local" }],
        "native"
      )
    ).toEqual(saved)
    expect(removeCustomModel(saved, "local")).toEqual([])
  })

  it("adds and re-enables custom models", () => {
    const added = upsertCustomModel([], " local ", "native")
    expect(added.models).toEqual([
      {
        id: "local",
        label: "local",
        enabled: true,
        source: "custom",
        pdfInput: "native",
      },
    ])
    expect(firstEnabledModelId(added.models)).toBe("local")
    expect(isEnabledModelId(added.models, "local")).toBe(true)
    expect(isEnabledModelId(added.models, "missing")).toBe(false)
  })
})

describe("catalog payloads", () => {
  it("keeps named rows and treats a failed empty payload as an error", () => {
    expect(
      parseProviderCatalogPayload({
        models: [
          { id: "gpt-4o", name: " GPT-4o " },
          { id: "", name: "skip" },
          { name: "no-id" },
        ],
      })
    ).toEqual({
      models: [{ id: "gpt-4o", name: "GPT-4o" }],
      error: "",
    })
    expect(
      parseProviderCatalogPayload({ error: "Unauthorized", models: [] })
    ).toEqual({ models: [], error: "Unauthorized" })
    expect(parseProviderCatalogPayload({ models: [] })).toEqual({
      models: [],
      error: "",
    })
  })
})
