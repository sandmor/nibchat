import { z } from "zod"

export const policyModeSchema = z.enum(["default", "require", "release"])

export type PolicyMode = z.infer<typeof policyModeSchema>
