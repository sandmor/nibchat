import { db } from "@/lib/db"
import {
  OWNER_FORBIDDEN_MESSAGE,
  UNAUTHORIZED_MESSAGE,
  requireUser,
} from "@/lib/app-session"
import { parseJson } from "@/lib/domain"
import { providerConfigFromJson } from "@/lib/provider-config"
import { resolveConfigEntries } from "@/lib/config-entries"
import { jsonError } from "@/lib/http-error"
import {
  discoverProviderCatalog,
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
      const cachedModels = parseJson<CatalogModel[]>(cached.models_json, [])
      return Response.json({
        models: publicCatalogModels(cachedModels),
        cachedAt: cached.refreshed_at,
      })
    }
    // Discovery performs an authenticated server-side request to the provider.
    // Regular users may read an existing catalog, but must never cause one.
    if (!isOwner) return Response.json({ models: [] })
    const config = providerConfigFromJson(profile.config_json)
    const headers = resolveConfigEntries(config.headers)
    const discovered = await discoverProviderCatalog(
      { kind: profile.kind, name: profile.name },
      { baseUrl: config.baseUrl ?? null },
      headers
    )
    const refreshedAt = new Date().toISOString()
    // A successful empty discovery is authoritative. A thrown failure must not
    // erase the last known catalog or prune editor selections.
    await db
      .insertInto("model_catalog_cache")
      .values({
        provider_id: profile.id,
        models_json: JSON.stringify(discovered),
        refreshed_at: refreshedAt,
      })
      .onConflict((oc) =>
        oc.column("provider_id").doUpdateSet({
          models_json: JSON.stringify(discovered),
          refreshed_at: refreshedAt,
        })
      )
      .execute()
    return Response.json({
      models: publicCatalogModels(discovered),
      cachedAt: refreshedAt,
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
