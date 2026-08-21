import type { SessionUser } from "@/lib/identity/ports"

export type AppGate =
  | { status: "ok"; user: SessionUser }
  | { status: "setup" }
  | { status: "onboarding"; user: SessionUser }
  | { status: "login" }

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
  if (!onboardingComplete) {
    return sessionUser.id === ownerUserId
      ? { status: "onboarding", user: sessionUser }
      : { status: "login" }
  }
  return { status: "ok", user: sessionUser }
}
