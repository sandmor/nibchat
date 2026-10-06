import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { db, migrate } from "@/lib/db"
import { PATCH } from "./[attachmentId]/route"
import { savePdfAnalysis } from "@/lib/attachments"

vi.mock("@/lib/app-session", () => ({
  requireUser: async () => ({ id: "analysis-diagnostic-user" }),
}))
vi.mock("@/lib/attachments", () => ({ savePdfAnalysis: vi.fn() }))
beforeAll(async () => {
  await migrate()
  const now = new Date().toISOString()
  await db
    .insertInto("user")
    .values({
      id: "analysis-diagnostic-user",
      name: "User",
      email: "analysis@test.local",
      emailVerified: 1 as unknown as boolean,
      image: null,
      createdAt: now,
      updatedAt: now,
    })
    .execute()
})
beforeEach(() => {
  vi.mocked(savePdfAnalysis).mockReset()
})
describe("analysis save activity", () => {
  it("records a successful save of failed analysis as a save, not processing success", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/attachments/a", {
        method: "PATCH",
        body: JSON.stringify({ version: 1, status: "failed" }),
      }),
      { params: Promise.resolve({ attachmentId: "a" }) }
    )
    expect(response.status).toBe(200)
    const operation = await db
      .selectFrom("diagnostic_operations")
      .selectAll()
      .where("kind", "=", "attachment.analysis.save")
      .executeTakeFirstOrThrow()
    expect(operation.outcome).toBe("complete")
    expect(JSON.parse(operation.metadata_json)).toMatchObject({
      attachmentId: "a",
      analysisStatus: "failed",
    })
  })
  it("records failure to save on the terminal event", async () => {
    vi.mocked(savePdfAnalysis).mockImplementation(() => {
      throw new Error("Private database response")
    })
    const response = await PATCH(
      new Request("http://localhost/api/attachments/b", {
        method: "PATCH",
        body: JSON.stringify({ version: 1, status: "unavailable" }),
      }),
      { params: Promise.resolve({ attachmentId: "b" }) }
    )
    expect(response.status).toBe(400)
    const operation = await db
      .selectFrom("diagnostic_operations")
      .selectAll()
      .where("kind", "=", "attachment.analysis.save")
      .where("outcome", "=", "error")
      .executeTakeFirstOrThrow()
    expect(JSON.parse(operation.metadata_json)).toMatchObject({
      attachmentId: "b",
      errorType: "Error",
    })
    const events = await db
      .selectFrom("diagnostic_events")
      .selectAll()
      .where("operation_id", "=", operation.id)
      .execute()
    expect(events.map((row) => row.event)).toEqual([
      "operation.started",
      "operation.finished",
    ])
    expect(JSON.stringify(events)).not.toContain("Private database response")
  })
})
