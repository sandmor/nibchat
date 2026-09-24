import { z } from "zod"
import {
  modelIdentitySchema,
  titleInstructionsSchema,
  titleStrategySchema,
  type SettingValues,
} from "@/lib/chat-settings/catalog"

export const titleSettingsSchema = z.object({
  titleStrategy: titleStrategySchema.optional(),
  titleModel: modelIdentitySchema.optional(),
  titleInstructions: titleInstructionsSchema.optional(),
})

export type TitleSettings = z.infer<typeof titleSettingsSchema>

export function parseAdminTitleSettings(
  raw: string | null | undefined
): TitleSettings {
  if (!raw) return {}
  try {
    const current = titleSettingsSchema.safeParse(JSON.parse(raw))
    return current.success ? current.data : {}
  } catch {
    return {}
  }
}

export function titleSettingsFromValues(values: SettingValues): TitleSettings {
  return {
    ...(values.titleStrategy ? { titleStrategy: values.titleStrategy } : {}),
    ...(values.titleModel ? { titleModel: values.titleModel } : {}),
    ...(values.titleInstructions
      ? { titleInstructions: values.titleInstructions }
      : {}),
  }
}
