import "server-only"
import { z } from "zod"
import { db, fromDbBool, toDbBool } from "@/lib/db"
import { id, now } from "@/lib/domain"
import { ensureUserSettings } from "@/lib/user-settings"
import { modelConfigSchema } from "@/lib/chat-settings"
import { MAX_COLLECTION, MAX_DESCRIPTION, MAX_ID, MAX_NAME } from "@/lib/limits"

export const helperProfileInput = z.object({
  name: z.string().trim().min(1).max(MAX_NAME),
  key: z
    .string()
    .trim()
    .min(1)
    .max(MAX_ID)
    .regex(/^[a-z][a-z0-9_]*$/),
  description: z.string().trim().min(1).max(MAX_DESCRIPTION),
  promptStackId: z.string().min(1),
  model: modelConfigSchema.nullable(),
  mcpMode: z.enum(["inherit", "none"]),
  allowTask: z.boolean(),
  contextMode: z.enum(["conversation", "task"]),
})

export async function listHelperProfiles(userId: string) {
  const rows = await db
    .selectFrom("helper_profiles")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("name")
    .execute()
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    promptStackId: row.prompt_stack_id,
    model: row.model_json
      ? modelConfigSchema.parse(JSON.parse(row.model_json))
      : null,
    mcpMode: row.mcp_mode,
    allowTask: fromDbBool(row.allow_task),
    contextMode: row.context_mode,
  }))
}

export async function saveHelperProfile(
  userId: string,
  input: z.infer<typeof helperProfileInput> & { id?: string }
) {
  await ensureUserSettings(userId)
  const value = helperProfileInput.parse(input)
  const stack = await db
    .selectFrom("prompt_stacks")
    .select("id")
    .where("id", "=", value.promptStackId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!stack) throw new Error("Prompt stack not found")
  const existing = input.id
    ? await db
        .selectFrom("helper_profiles")
        .selectAll()
        .where("id", "=", input.id)
        .where("user_id", "=", userId)
        .executeTakeFirst()
    : null
  if (input.id && !existing) throw new Error("Helper not found")
  if (!existing) {
    const count = await db
      .selectFrom("helper_profiles")
      .select("id")
      .where("user_id", "=", userId)
      .execute()
    if (count.length >= MAX_COLLECTION)
      throw new Error(`You can create at most ${MAX_COLLECTION} helpers`)
  }
  const fields = {
    key: value.key,
    name: value.name,
    description: value.description,
    prompt_stack_id: value.promptStackId,
    model_json: value.model ? JSON.stringify(value.model) : null,
    mcp_mode: value.mcpMode,
    allow_task: toDbBool(value.allowTask),
    context_mode: value.contextMode,
    updated_at: now(),
  }
  if (existing)
    await db
      .updateTable("helper_profiles")
      .set(fields)
      .where("id", "=", existing.id)
      .execute()
  else
    await db
      .insertInto("helper_profiles")
      .values({
        ...fields,
        id: id(),
        user_id: userId,
        created_at: now(),
      })
      .execute()
  return listHelperProfiles(userId)
}

export async function deleteHelperProfile(userId: string, helperId: string) {
  const row = await db
    .selectFrom("helper_profiles")
    .selectAll()
    .where("id", "=", helperId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!row) throw new Error("Helper not found")
  await db.deleteFrom("helper_profiles").where("id", "=", helperId).execute()
  return listHelperProfiles(userId)
}
