import type { SessionUser } from "@/lib/identity/ports"
import {
  OWNER_FORBIDDEN_MESSAGE,
  UNAUTHORIZED_MESSAGE,
} from "@/lib/auth-messages"

export type AppGate =
  | { status: "ok"; user: SessionUser }
  | { status: "setup" }
  | { status: "onboarding"; user: SessionUser }
  | { status: "login" }
  | { status: "wrong_account" }

export { OWNER_FORBIDDEN_MESSAGE, UNAUTHORIZED_MESSAGE }

/** Pure decision: owner id × optional session user × onboarding → gate. */
export function decideGate(
  ownerUserId: string | null,
  sessionUser: SessionUser | null,
  onboardingComplete = true
): AppGate {
  if (!ownerUserId) {
    // Unowned instance — setup UX even if a session exists (caller may claim first).
    return { status: "setup" }
  }
  if (!sessionUser) return { status: "login" }
  if (sessionUser.id !== ownerUserId) return { status: "wrong_account" }
  if (!onboardingComplete) return { status: "onboarding", user: sessionUser }
  return { status: "ok", user: sessionUser }
}
