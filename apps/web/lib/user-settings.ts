import "server-only"
import { db } from "@/lib/db"
import { id, now, parseJson } from "@/lib/domain"
import {
  modelConfigSchema,
  modelConfigToSettingValues,
  parseUserSettingValues,
  replaceGenerationSlice,
  seededUserDefaults,
  userPromptStackId,
  userSettingValuesToJson,
  type ModelConfig,
} from "@/lib/chat-settings"
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
import { readContextBook } from "@/lib/context-books"
import {
  builtInToolsToJson,
  defaultBuiltInToolsPrefs,
  normalizeBuiltInToolsDisabled,
  parseBuiltInToolsJson,
  type BuiltInToolsPrefs,
} from "@/lib/agent/tools/catalog"

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
      theme_mode: "system" as const,
      builtin_tools_json: builtInToolsToJson(defaultBuiltInToolsPrefs),
      chat_defaults_json: userSettingValuesToJson(
        seededUserDefaults(defaultPromptStackId)
      ),
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
  const contextBooks = await db
    .selectFrom("context_books")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("name")
    .execute()
  return {
    ...prefs,
    themes: themes.map(
      (theme): ThemeRecord => ({
        id: theme.id,
        name: theme.name,
        document: parseAppearance(parseJson(theme.document_json, {})),
        created_at: theme.created_at,
        updated_at: theme.updated_at,
      })
    ),
    promptStacks: promptStacks.map((stack) => ({
      id: stack.id,
      name: stack.name,
      stack: readStackJson(stack.stack_json) as PromptStackDocument,
      created_at: stack.created_at,
      updated_at: stack.updated_at,
    })),
    contextBooks: contextBooks.map((row) => ({
      id: row.id,
      name: row.name,
      book: readContextBook(parseJson(row.book_json, {})),
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
    promptStackId: userPromptStackId(
      parseUserSettingValues(prefs.chat_defaults_json)
    ),
  }
}

export async function setChatDefaults(userId: string, config: ModelConfig) {
  await ensureUserSettings(userId)
  const parsed = modelConfigSchema.parse(config)
  if (parsed.providerId) {
    const provider = await db
      .selectFrom("provider_profiles")
      .select("id")
      .where("id", "=", parsed.providerId)
      .executeTakeFirst()
    if (!provider) throw new Error("Provider not found")
  }
  const current = await db
    .selectFrom("user_preferences")
    .select("chat_defaults_json")
    .where("user_id", "=", userId)
    .executeTakeFirstOrThrow()
  const next = replaceGenerationSlice(
    parseUserSettingValues(current.chat_defaults_json),
    modelConfigToSettingValues(parsed)
  )
  await db
    .updateTable("user_preferences")
    .set({
      chat_defaults_json: userSettingValuesToJson(next),
      updated_at: now(),
    })
    .where("user_id", "=", userId)
    .execute()
}

export async function setUserPromptStack(userId: string, stackId: string) {
  const existing = await db
    .selectFrom("prompt_stacks")
    .select("id")
    .where("id", "=", stackId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!existing) throw new Error("Prompt stack not found")
  const prefs = await ensureUserSettings(userId)
  const next = parseUserSettingValues(prefs.chat_defaults_json)
  next.promptStack = stackId
  await db
    .updateTable("user_preferences")
    .set({
      chat_defaults_json: userSettingValuesToJson(next),
      updated_at: now(),
    })
    .where("user_id", "=", userId)
    .execute()
  return { ok: true as const, defaultPromptStackId: stackId }
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
    .set({
      light_theme_id: lightThemeId,
      dark_theme_id: darkThemeId,
      updated_at: now(),
    })
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

export async function getBuiltInToolsPrefs(
  userId: string
): Promise<BuiltInToolsPrefs> {
  await ensureUserSettings(userId)
  const row = await db
    .selectFrom("user_preferences")
    .select("builtin_tools_json")
    .where("user_id", "=", userId)
    .executeTakeFirstOrThrow()
  return parseBuiltInToolsJson(row.builtin_tools_json)
}

export async function setBuiltInToolsPrefs(
  userId: string,
  disabled: readonly string[]
): Promise<BuiltInToolsPrefs> {
  await ensureUserSettings(userId)
  const prefs: BuiltInToolsPrefs = {
    disabled: normalizeBuiltInToolsDisabled(disabled),
  }
  await db
    .updateTable("user_preferences")
    .set({
      builtin_tools_json: builtInToolsToJson(prefs),
      updated_at: now(),
    })
    .where("user_id", "=", userId)
    .execute()
  return prefs
}
