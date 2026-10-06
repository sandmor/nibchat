import { describe, expect, it, vi } from "vitest"
import { appRouter, type createContext } from "@/lib/trpc"
import { logDiagnosticProcedure } from "@/lib/diagnostics"

vi.mock("@/lib/diagnostics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/diagnostics")>()),
  logDiagnosticProcedure: vi.fn(),
}))

describe("procedure logging around authorization", () => {
  it("logs rejected anonymous requests with a validated request ID", async () => {
    const caller = appRouter.createCaller({
      user: null,
      isOwner: false,
      headers: new Headers({ "x-request-id": "request-123" }),
      authError: "Unauthorized",
    })
    await expect(
      caller.workspace.activity.retentionDays()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" })
    expect(logDiagnosticProcedure).toHaveBeenCalledWith(
      expect.objectContaining({
        procedure: "workspace.activity.retentionDays",
        result: "UNAUTHORIZED",
        requestId: "request-123",
      })
    )
  })
  it("logs forbidden owner actions without persisting procedure activity", async () => {
    const user = { id: "non-owner" } as NonNullable<
      Awaited<ReturnType<typeof createContext>>["user"]
    >
    const caller = appRouter.createCaller({
      user,
      isOwner: false,
      headers: new Headers(),
      authError: null,
    })
    await expect(
      caller.workspace.activity.setRetentionDays({ retentionDays: 7 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(logDiagnosticProcedure).toHaveBeenCalledWith(
      expect.objectContaining({
        procedure: "workspace.activity.setRetentionDays",
        procedureType: "mutation",
        result: "FORBIDDEN",
        userId: user.id,
      })
    )
  })
})
