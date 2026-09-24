import { z } from "zod"

export const policyModeSchema = z.enum(["default", "require", "release"])

export type PolicyMode = z.infer<typeof policyModeSchema>

const POLICY_MODE_COPY: Record<PolicyMode, string> = {
  default: "Default; chats may override it",
  require: "Required for chats here",
  release: "Stops applying the parent value here",
}

export function policyModeCopy(mode: PolicyMode): string {
  return POLICY_MODE_COPY[mode]
}
