export type { SessionUser, IdentityPorts } from "@/lib/identity/ports"
export type { AppGate } from "@/lib/identity/gate"
export { decideGate } from "@/lib/identity/gate"
export {
  OWNER_FORBIDDEN_MESSAGE,
  UNAUTHORIZED_MESSAGE,
} from "@/lib/auth-messages"
/** Port-injectable gate — prefer `@/lib/app-session` for default ports. */
export {
  resolveAppUser as resolveAppUserWithPorts,
  requireOwner as requireOwnerWithPorts,
} from "@/lib/identity/resolve"
export { defaultIdentityPorts } from "@/lib/identity/default-ports"
