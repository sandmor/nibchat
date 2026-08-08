import { db } from "@/lib/db"
import { requireOwner } from "@/lib/auth"
import { parseJson } from "@/lib/domain"
import { jsonError } from "@/lib/http-error"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const user = await requireOwner(request.headers)
    const url = new URL(request.url)
    const providerId = url.searchParams.get("providerId")
    const profile = providerId
      ? await db
          .selectFrom("provider_profiles")
          .selectAll()
          .where("id", "=", providerId)
          .where("user_id", "=", user.id)
          .executeTakeFirst()
      : undefined
    if (!profile) return Response.json({ models: [] })
    const manual = parseJson<string[]>(profile.models_json, []).map((id) => ({
      id,
      name: id,
      source: "manual",
    }))
    const cached = await db
      .selectFrom("model_catalog_cache")
      .selectAll()
      .where("provider_id", "=", profile.id)
      .executeTakeFirst()
    if (!url.searchParams.has("refresh") && cached) {
      const cachedModels = parseJson<Array<{ id: string; name: string }>>(
        cached.models_json,
        []
      )
      return Response.json({
        models: [
          ...manual,
          ...cachedModels.filter(
            (model) => !manual.some((entry) => entry.id === model.id)
          ),
        ],
        cachedAt: cached.refreshed_at,
      })
    }
    let discovered: Array<{ id: string; name: string }> = []
    if (profile.kind === "openai-compatible" && profile.base_url) {
      const apiKey =
        profile.api_key ??
        (profile.api_key_env ? process.env[profile.api_key_env] : undefined)
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
        const payload = (await response.json()) as {
          data?: Array<{ id?: string }>
        }
        discovered = (payload.data ?? []).flatMap((model) =>
          model.id ? [{ id: model.id, name: model.id }] : []
        )
      }
    }
    if (!discovered.length) {
      const response = await fetch("https://models.dev/api.json", {
        signal: AbortSignal.timeout(8000),
      })
      if (response.ok) {
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
    if (discovered.length)
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
      models: [
        ...manual,
        ...discovered.filter(
          (model) => !manual.some((entry) => entry.id === model.id)
        ),
      ],
      cachedAt: discovered.length
        ? new Date().toISOString()
        : (cached?.refreshed_at ?? null),
    })
  } catch (error) {
    const authStatus =
      error instanceof Error &&
      (error.message === "Unauthorized" ||
        error.message === "This account is not the instance owner")
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
