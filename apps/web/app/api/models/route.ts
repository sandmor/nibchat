import { db } from "@/lib/db"
import {
  OWNER_FORBIDDEN_MESSAGE,
  UNAUTHORIZED_MESSAGE,
  requireUser,
} from "@/lib/app-session"
import { parseJson } from "@/lib/domain"
import { jsonError } from "@/lib/http-error"
import {
  discoverOllamaModels,
  protocolFromCatalogEntry,
  publicCatalogModels,
  type CatalogModel,
} from "@/lib/provider-catalog"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const user = await requireUser(request.headers)
    const url = new URL(request.url)
    const providerId = url.searchParams.get("providerId")
    const profile = providerId
      ? await db
          .selectFrom("provider_profiles")
          .selectAll()
          .where("id", "=", providerId)
          .executeTakeFirst()
      : undefined
    if (!profile) return Response.json({ models: [] })
    const owner = await db
      .selectFrom("instance")
      .select("owner_user_id")
      .where("id", "=", 1)
      .executeTakeFirst()
    const isOwner = owner?.owner_user_id === user.id
    if (url.searchParams.has("refresh") && !isOwner)
      return Response.json(
        { error: "Only the owner can refresh catalogs" },
        { status: 403 }
      )
    const cached = await db
      .selectFrom("model_catalog_cache")
      .selectAll()
      .where("provider_id", "=", profile.id)
      .executeTakeFirst()
    if (!url.searchParams.has("refresh") && cached) {
      const cachedModels = parseJson<CatalogModel[]>(
        cached.models_json,
        []
      )
      return Response.json({
        models: publicCatalogModels(cachedModels),
        cachedAt: cached.refreshed_at,
      })
    }
    // Discovery performs an authenticated server-side request to the provider.
    // Regular users may read an existing catalog, but must never cause one.
    if (!isOwner) return Response.json({ models: [] })
    let discovered: CatalogModel[] = []
    let discoverySucceeded = false
    const apiKey =
      profile.api_key ??
      (profile.api_key_env ? process.env[profile.api_key_env] : undefined)
    if (profile.kind === "ollama") {
      discovered = await discoverOllamaModels(profile, apiKey)
      discoverySucceeded = true
    } else if (profile.kind === "openai-compatible" && profile.base_url) {
      const response = await fetch(
        new URL(
          "models",
          profile.base_url.endsWith("/")
            ? profile.base_url
            : `${profile.base_url}/`
        ),
        {
          headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
          signal: AbortSignal.timeout(8000),
        }
      )
      if (response.ok) {
        discoverySucceeded = true
        const payload = (await response.json()) as { data?: Array<unknown> }
        discovered = (payload.data ?? []).flatMap((model) =>
          model &&
          typeof model === "object" &&
          typeof (model as { id?: unknown }).id === "string"
            ? [
                {
                  id: (model as { id: string }).id,
                  name:
                    typeof (model as { name?: unknown }).name === "string"
                      ? (model as { name: string }).name
                      : (model as { id: string }).id,
                  ...protocolFromCatalogEntry(model),
                },
              ]
            : []
        )
      }
    }
    if (!discovered.length && profile.kind !== "ollama") {
      const response = await fetch("https://models.dev/api.json", {
        signal: AbortSignal.timeout(8000),
      })
      if (response.ok) {
        discoverySucceeded = true
        const payload = (await response.json()) as Record<
          string,
          { models?: Record<string, { name?: string }> }
        >
        const family = profile.kind === "anthropic" ? "anthropic" : "openai"
        discovered = Object.entries(payload[family]?.models ?? {}).map(
          ([id, model]) => ({ id, name: model.name ?? id })
        )
      }
    }
    // A successful empty discovery is authoritative. A total discovery failure
    // must not erase the last known catalog or prune editor selections.
    if (discoverySucceeded)
      await db
        .insertInto("model_catalog_cache")
        .values({
          provider_id: profile.id,
          models_json: JSON.stringify(discovered),
          refreshed_at: new Date().toISOString(),
        })
        .onConflict((oc) =>
          oc.column("provider_id").doUpdateSet({
            models_json: JSON.stringify(discovered),
            refreshed_at: new Date().toISOString(),
          })
        )
        .execute()
    return Response.json({
      models: publicCatalogModels(discovered),
      cachedAt: discoverySucceeded
        ? new Date().toISOString()
        : (cached?.refreshed_at ?? null),
    })
  } catch (error) {
    const authStatus =
      error instanceof Error &&
      (error.message === UNAUTHORIZED_MESSAGE ||
        error.message === OWNER_FORBIDDEN_MESSAGE)
    if (authStatus) return jsonError(error)
    return Response.json(
      {
        models: [],
        error:
          error instanceof Error ? error.message : "Model discovery failed",
      },
      { status: 200 }
    )
  }
}
