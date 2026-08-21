import { describe, expect, it, vi } from "vitest"
import { resolveAppUser } from "@/lib/identity/resolve"
import type { IdentityPorts, SessionUser } from "@/lib/identity/ports"

function user(id: string): SessionUser {
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    emailVerified: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }
}

function ports(
  partial: Partial<{
    owner: string | null
    session: SessionUser | null
    onboardingComplete: boolean
  }>
): IdentityPorts & { tryClaim: ReturnType<typeof vi.fn> } {
  const tryClaim = vi.fn(async () => false)
  return {
    tryClaim,
    schema: { migrate: vi.fn(async () => {}) },
    session: {
      getSession: vi.fn(async () =>
        partial.session ? { user: partial.session } : null
      ),
    },
    instance: {
      getOwnerUserId: vi.fn(async () => partial.owner ?? null),
      tryClaimOwner: tryClaim,
      isOnboardingComplete: vi.fn(
        async () => partial.onboardingComplete ?? partial.owner != null
      ),
      completeOnboarding: vi.fn(async () => {}),
    },
  }
}

describe("resolveAppUser (read-only gate)", () => {
  it("does not claim when unowned with a session", async () => {
    const session = user("u1")
    const p = ports({ owner: null, session })
    const gate = await resolveAppUser(p, new Headers())
    expect(gate).toEqual({ status: "setup" })
    expect(p.tryClaim).not.toHaveBeenCalled()
  })

  it("returns ok for owner session", async () => {
    const session = user("owner")
    const p = ports({ owner: "owner", session })
    expect(await resolveAppUser(p, new Headers())).toEqual({
      status: "ok",
      user: session,
    })
  })

  it("returns ok for a regular user session", async () => {
    const p = ports({ owner: "owner", session: user("other") })
    expect((await resolveAppUser(p, new Headers())).status).toBe("ok")
  })

  it("returns login when owned without session", async () => {
    const p = ports({ owner: "owner", session: null })
    expect(await resolveAppUser(p, new Headers())).toEqual({ status: "login" })
  })

  it("returns onboarding for owner session before setup is finished", async () => {
    const session = user("owner")
    const p = ports({
      owner: "owner",
      session,
      onboardingComplete: false,
    })
    expect(await resolveAppUser(p, new Headers())).toEqual({
      status: "onboarding",
      user: session,
    })
  })

  it("setup when unowned and no session", async () => {
    const p = ports({ owner: null, session: null })
    expect(await resolveAppUser(p, new Headers())).toEqual({ status: "setup" })
    expect(p.tryClaim).not.toHaveBeenCalled()
  })
})
