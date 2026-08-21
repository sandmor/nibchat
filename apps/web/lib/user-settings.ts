import "server-only"
import { db } from "@/lib/db"
import { id, now, parseJson } from "@/lib/domain"
import {
  appearanceToJson,
  parseAppearance,
  SEED_THEMES,
  type ThemeRecord,
} from "@/lib/appearance"
import {
  defaultPromptStack,
  promptStackToJson,
  readStackJson,
  type PromptStackDocument,
} from "@/lib/prompt-stack"

/** Ensure a newly-created account has private settings/library rows. */
export async function ensureUserSettings(userId: string) {
  return db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom("user_preferences")
      .selectAll()
      .where("user_id", "=", userId)
      .executeTakeFirst()
    if (existing) return existing

    const timestamp = now()
    const themeIds = new Map<string, string>()
    for (const source of SEED_THEMES) {
      const themeId = id()
      await trx
        .insertInto("themes")
        .values({
          id: themeId,
          user_id: userId,
          name: source.name,
          document_json: appearanceToJson(source.document, false),
          created_at: timestamp,
          updated_at: timestamp,
        })
        .execute()
      themeIds.set(source.id, themeId)
    }

    const defaultPromptStackId = id()
    await trx
      .insertInto("prompt_stacks")
      .values({
        id: defaultPromptStackId,
        user_id: userId,
        name: "Default",
        stack_json: promptStackToJson(defaultPromptStack()),
        created_at: timestamp,
        updated_at: timestamp,
      })
      .execute()
    const lightThemeId = themeIds.get("paper")
    const darkThemeId = themeIds.get("ink")
    if (!lightThemeId || !darkThemeId || !defaultPromptStackId)
      throw new Error("Could not seed user settings")

    const prefs = {
      user_id: userId,
      light_theme_id: lightThemeId,
      dark_theme_id: darkThemeId,
      default_prompt_stack_id: defaultPromptStackId,
      theme_mode: "system" as const,
      created_at: timestamp,
      updated_at: timestamp,
    }
    await trx.insertInto("user_preferences").values(prefs).execute()
    return prefs
  })
}

export async function getUserSettings(userId: string) {
  await ensureUserSettings(userId)
  const prefs = await db
    .selectFrom("user_preferences")
    .selectAll()
    .where("user_id", "=", userId)
    .executeTakeFirstOrThrow()
  const themes = await db
    .selectFrom("themes")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("name")
    .execute()
  const promptStacks = await db
    .selectFrom("prompt_stacks")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("name")
    .execute()
  return {
    ...prefs,
    themes: themes.map((theme): ThemeRecord => ({
      id: theme.id,
      name: theme.name,
      document: parseAppearance(parseJson(theme.document_json, {})),
      created_at: theme.created_at,
      updated_at: theme.updated_at,
    })),
    promptStacks: promptStacks.map((stack) => ({
      id: stack.id,
      name: stack.name,
      stack: readStackJson(stack.stack_json) as PromptStackDocument,
      created_at: stack.created_at,
      updated_at: stack.updated_at,
    })),
  }
}

export async function setUserThemeSlots(
  userId: string,
  lightThemeId: string,
  darkThemeId: string
) {
  await ensureUserSettings(userId)
  const themes = await db
    .selectFrom("themes")
    .select("id")
    .where("user_id", "=", userId)
    .where("id", "in", [lightThemeId, darkThemeId])
    .execute()
  const ownedThemeIds = new Set(themes.map((theme) => theme.id))
  if (!ownedThemeIds.has(lightThemeId) || !ownedThemeIds.has(darkThemeId))
    throw new Error("Theme not found")
  await db
    .updateTable("user_preferences")
    .set({ light_theme_id: lightThemeId, dark_theme_id: darkThemeId, updated_at: now() })
    .where("user_id", "=", userId)
    .execute()
  return { lightThemeId, darkThemeId }
}

export async function setUserThemeMode(
  userId: string,
  themeMode: "system" | "light" | "dark"
) {
  await ensureUserSettings(userId)
  await db
    .updateTable("user_preferences")
    .set({ theme_mode: themeMode, updated_at: now() })
    .where("user_id", "=", userId)
    .execute()
}
