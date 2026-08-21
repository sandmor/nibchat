import type { IdentityPorts } from "@/lib/identity/ports"
import { decideGate, type AppGate } from "@/lib/identity/gate"
import {
  OWNER_FORBIDDEN_MESSAGE,
  UNAUTHORIZED_MESSAGE,
} from "@/lib/auth-messages"

/**
 * Read-only identity gate. Does not claim ownership — claim only on
 * sign-up / sign-in (auth route), never on page or API reads.
 */
export async function resolveAppUser(
  ports: IdentityPorts,
  headers: Headers
): Promise<AppGate> {
  await ports.schema.migrate()
  const ownerUserId = await ports.instance.getOwnerUserId()
  const session = await ports.session.getSession(headers)
  const onboardingComplete = ownerUserId
    ? await ports.instance.isOnboardingComplete()
    : false
  const gate = decideGate(ownerUserId, session?.user ?? null, onboardingComplete)
  return gate
}

/** Map gate to throw with stable messages for REST / tRPC. */
export async function requireOwner(ports: IdentityPorts, headers: Headers) {
  const gate = await resolveAppUser(ports, headers)
  if (
    (gate.status === "ok" || gate.status === "onboarding") &&
    gate.user.id === (await ports.instance.getOwnerUserId())
  )
    return gate.user
  if (gate.status === "ok" || gate.status === "onboarding")
    throw new Error(OWNER_FORBIDDEN_MESSAGE)
  throw new Error(UNAUTHORIZED_MESSAGE)
}
