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

  it("returns wrong_account for non-owner session", async () => {
    const p = ports({ owner: "owner", session: user("other") })
    expect((await resolveAppUser(p, new Headers())).status).toBe(
      "wrong_account"
    )
  })

  it("returns login when owned without session", async () => {
    const p = ports({ owner: "owner", session: null })
    expect(await resolveAppUser(p, new Headers())).toEqual({ status: "login" })
  })

  it("setup when unowned and no session", async () => {
    const p = ports({ owner: null, session: null })
    expect(await resolveAppUser(p, new Headers())).toEqual({ status: "setup" })
    expect(p.tryClaim).not.toHaveBeenCalled()
  })
})
