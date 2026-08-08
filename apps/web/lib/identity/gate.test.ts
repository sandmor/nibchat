import { describe, expect, it } from "vitest"
import { decideGate } from "@/lib/identity/gate"
import type { SessionUser } from "@/lib/identity/ports"

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

describe("decideGate", () => {
  it("returns setup when unowned", () => {
    expect(decideGate(null, null)).toEqual({ status: "setup" })
    expect(decideGate(null, user("u1"))).toEqual({ status: "setup" })
  })

  it("returns login when owned without session", () => {
    expect(decideGate("owner", null)).toEqual({ status: "login" })
  })

  it("returns wrong_account when session is not owner", () => {
    expect(decideGate("owner", user("other"))).toEqual({
      status: "wrong_account",
    })
  })

  it("returns ok for owner session", () => {
    const session = user("owner")
    expect(decideGate("owner", session)).toEqual({
      status: "ok",
      user: session,
    })
  })
})
