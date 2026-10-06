import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db, migrate } from "@/lib/db"
import {
  listDiagnosticOperations,
  clearDiagnosticHistory,
  exportDiagnosticEvents,
  setDiagnosticRetentionDays,
  startDiagnosticOperation,
  procedureDiagnosticLevel,
  logDiagnosticFailure,
} from "@/lib/diagnostics"

const { logs } = vi.hoisted(() => ({
  logs: [] as Array<Record<string, unknown>>,
}))
vi.mock("pino", () => ({
  default: Object.assign(
    () =>
      Object.fromEntries(
        ["info", "warn", "error", "debug"].map((level) => [
          level,
          (fields: object) => logs.push({ level, ...fields }),
        ])
      ),
    { stdTimeFunctions: { isoTime: () => "" } }
  ),
}))

beforeAll(async () => {
  await migrate()
})

afterAll(async () => {
  await db
    .deleteFrom("diagnostic_operations")
    .where("kind", "in", [
      "attachment.upload",
      "backup.export",
      "backup.restore",
    ])
    .execute()
})

describe("diagnostic operations", () => {
  it("allows only one terminal transition across competing handles", async () => {
    const id = crypto.randomUUID()
    const first = await startDiagnosticOperation({ id, kind: "backup.export" })
    const second = await startDiagnosticOperation({ id, kind: "backup.export" })
    await Promise.all([first.finish("complete"), second.finish("error")])
    const rows = await db
      .selectFrom("diagnostic_events")
      .selectAll()
      .where("operation_id", "=", id)
      .execute()
    expect(
      rows.filter((row) => row.event === "operation.started")
    ).toHaveLength(1)
    expect(
      rows.filter((row) => row.event === "operation.finished")
    ).toHaveLength(1)
    expect(
      logs.filter(
        (row) => row.operationId === id && row.event === "operation.finished"
      )
    ).toHaveLength(1)
  })

  it("inherits context and protects identity and lifecycle duration", async () => {
    const id = crypto.randomUUID()
    const operation = await startDiagnosticOperation({
      id,
      kind: "chat.reply.generate",
      context: { generationId: id, actionId: "original-action" },
    })
    await operation.updateContext({
      model: "resolved-model",
      generationId: "spoofed",
    })
    const reopened = await startDiagnosticOperation({
      id,
      kind: "chat.reply.generate",
    })
    await reopened.updateContext({
      generationId: "spoofed",
      actionId: "spoofed",
    })
    await operation.warn("compaction_failed", { actionId: "spoofed" })
    await operation.finish("awaiting_input", {
      durationMs: -1,
      modelDurationMs: 12,
      generationId: "spoofed",
    })
    const row = await db
      .selectFrom("diagnostic_operations")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow()
    expect(JSON.parse(row.metadata_json)).toMatchObject({
      generationId: id,
      actionId: "original-action",
      model: "resolved-model",
      modelDurationMs: 12,
    })
    expect(row.duration_ms).toBeGreaterThanOrEqual(0)
    expect(
      logs.find(
        (row) => row.operationId === id && row.event === "operation.warning"
      )
    ).toMatchObject({
      operation: "chat.reply.generate",
      generationId: id,
      actionId: "original-action",
      model: "resolved-model",
    })
  })

  it("filters and exports persisted warning and terminal details", async () => {
    const operation = await startDiagnosticOperation({ kind: "backup.restore" })
    await operation.warn("recoverable", { count: 2 })
    await operation.finish(
      "fallback",
      { reason: "timeout", usage: { inputTokens: 4 } },
      new DOMException("private", "TimeoutError")
    )
    const page = await listDiagnosticOperations({
      userId: "*",
      isOwner: true,
      kind: "backup.restore",
      outcome: "fallback",
      level: "warn",
      limit: 1,
    })
    expect(page.operations[0]?.metadata).toMatchObject({
      reason: "timeout",
      errorType: "TimeoutError",
      usage: { inputTokens: 4 },
    })
    const exported = await exportDiagnosticEvents({
      userId: "*",
      isOwner: true,
      kind: "backup.restore",
      outcome: "fallback",
      level: "warn",
    })
    expect(
      exported.filter((row) => row.operation_id === operation.id)
    ).toHaveLength(2)
    expect(
      exported
        .filter((row) => row.operation_id === operation.id)
        .every((row) => row.operation === "backup.restore")
    ).toBe(true)
  })

  it("selects request severity and throttles repetitive failures by scope", () => {
    expect(
      procedureDiagnosticLevel({
        result: "ok",
        procedureType: "query",
        durationMs: 999,
      })
    ).toBe("debug")
    expect(
      procedureDiagnosticLevel({
        result: "ok",
        procedureType: "query",
        durationMs: 1000,
      })
    ).toBe("info")
    expect(
      procedureDiagnosticLevel({
        result: "ok",
        procedureType: "mutation",
        durationMs: 1,
      })
    ).toBe("info")
    expect(
      procedureDiagnosticLevel({
        result: "UNAUTHORIZED",
        procedureType: "query",
        durationMs: 1,
      })
    ).toBe("warn")
    expect(
      procedureDiagnosticLevel({
        result: "INTERNAL_SERVER_ERROR",
        procedureType: "query",
        durationMs: 1,
      })
    ).toBe("error")
    vi.useFakeTimers()
    try {
      const generationId = crypto.randomUUID()
      logDiagnosticFailure(
        "generation.cancel_poll_failed",
        new Error("private"),
        "warn",
        { generationId }
      )
      logDiagnosticFailure(
        "generation.cancel_poll_failed",
        new Error("private"),
        "warn",
        { generationId }
      )
      vi.advanceTimersByTime(60_000)
      logDiagnosticFailure(
        "generation.cancel_poll_failed",
        new Error("private"),
        "warn",
        { generationId }
      )
      expect(
        logs.filter(
          (row) =>
            row.event === "generation.cancel_poll_failed" &&
            row.generationId === generationId
        )
      ).toHaveLength(2)
      expect(logs.at(-1)).toMatchObject({ suppressedCount: 1 })
    } finally {
      vi.useRealTimers()
    }
  })
  it("records bounded metadata and finishes once", async () => {
    const operation = await startDiagnosticOperation({
      kind: "attachment.upload",
      metadata: {
        providerId: "provider-test",
        model: "model-test",
        // @ts-expect-error Deliberately exercise runtime sanitation.
        prompt: "private conversation text",
        apiKey: "secret",
        usage: { inputTokens: 12, outputTokens: 4, other: "omit" },
      },
    })
    await operation.finish("complete", {
      status: "complete",
      finishReason: "stop",
    })
    await operation.finish("error", { reason: "second finish is ignored" })

    const page = await listDiagnosticOperations({
      userId: "*",
      isOwner: true,
      limit: 50,
      kind: "attachment.upload",
    })
    const recorded = page.operations.find((row) => row.id === operation.id)
    expect(recorded?.outcome).toBe("complete")
    expect(recorded?.metadata).toEqual({
      providerId: "provider-test",
      model: "model-test",
      usage: { inputTokens: 12, outputTokens: 4 },
      status: "complete",
      finishReason: "stop",
      outcome: "complete",
      durationMs: expect.any(Number),
    })
    expect(recorded?.events.map((event) => event.event)).toEqual([
      "operation.started",
      "operation.finished",
    ])
    expect(JSON.stringify(recorded)).not.toContain("private conversation text")
    expect(JSON.stringify(recorded)).not.toContain("secret")
  })

  it("records safe failure details without persisting error messages", async () => {
    const operation = await startDiagnosticOperation({
      kind: "backup.export",
    })
    await operation.warn(
      "provider_unavailable",
      {},
      new Error("private provider response")
    )

    const page = await listDiagnosticOperations({
      userId: "*",
      isOwner: true,
      kind: "backup.export",
    })
    const recorded = page.operations.find((row) => row.id === operation.id)
    expect(recorded?.outcome).toBe("running")
    expect(recorded?.events[1]?.metadata).toMatchObject({
      errorType: "Error",
      reason: "provider_unavailable",
    })
    expect(JSON.stringify(recorded)).not.toContain("private provider response")
    await operation.finish("complete")
  })

  it("filters since by when the operation started", async () => {
    await setDiagnosticRetentionDays(7)
    const stale = await startDiagnosticOperation({
      kind: "backup.restore",
    })
    const startedAt = new Date(Date.now() - 2 * 86_400_000).toISOString()
    await db
      .updateTable("diagnostic_operations")
      .set({ started_at: startedAt })
      .where("id", "=", stale.id)
      .execute()
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const excluded = await listDiagnosticOperations({
      userId: "*",
      isOwner: true,
      kind: "backup.restore",
      since,
    })
    expect(excluded.operations.map((row) => row.id)).not.toContain(stale.id)

    const recent = await startDiagnosticOperation({
      kind: "backup.restore",
    })
    const included = await listDiagnosticOperations({
      userId: "*",
      isOwner: true,
      kind: "backup.restore",
      since,
    })
    expect(included.operations.map((row) => row.id)).toContain(recent.id)
    expect(included.operations.map((row) => row.id)).not.toContain(stale.id)
    await stale.finish("complete")
    await recent.finish("complete")
  })

  it("hides expired history and exports before another write triggers cleanup", async () => {
    const operation = await startDiagnosticOperation({
      kind: "attachment.upload",
    })
    const expired = new Date(Date.now() - 8 * 86_400_000).toISOString()
    await db
      .updateTable("diagnostic_operations")
      .set({ started_at: expired })
      .where("id", "=", operation.id)
      .execute()
    const page = await listDiagnosticOperations({
      userId: "*",
      isOwner: true,
      kind: "attachment.upload",
    })
    expect(page.operations.map((row) => row.id)).not.toContain(operation.id)
    const exported = await exportDiagnosticEvents({
      userId: "*",
      isOwner: true,
    })
    expect(exported.map((row) => row.operation_id)).not.toContain(operation.id)
    await setDiagnosticRetentionDays(7)
    expect(
      await db
        .selectFrom("diagnostic_operations")
        .select("id")
        .where("id", "=", operation.id)
        .executeTakeFirst()
    ).toBeUndefined()
  })
  it("isolates users' history, exports, and clearing", async () => {
    const now = new Date().toISOString()
    for (const id of ["diagnostics-user-a", "diagnostics-user-b"]) {
      await db
        .insertInto("user")
        .values({
          id,
          name: id,
          email: `${id}@test.local`,
          emailVerified: 1 as unknown as boolean,
          image: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute()
    }
    try {
      const a = await startDiagnosticOperation({
        kind: "attachment.upload",
        context: { userId: "diagnostics-user-a" },
      })
      const b = await startDiagnosticOperation({
        kind: "attachment.upload",
        context: { userId: "diagnostics-user-b" },
      })
      const own = await listDiagnosticOperations({
        userId: "diagnostics-user-a",
        isOwner: false,
      })
      expect(own.operations.map((row) => row.id)).toEqual([a.id])
      const exported = await exportDiagnosticEvents({
        userId: "diagnostics-user-a",
        isOwner: false,
      })
      expect(exported.map((row) => row.operation_id)).toEqual([a.id])
      const all = await listDiagnosticOperations({ userId: "*", isOwner: true })
      expect(all.operations.map((row) => row.id)).toEqual(
        expect.arrayContaining([a.id, b.id])
      )
      await clearDiagnosticHistory("diagnostics-user-a", false)
      const remaining = await listDiagnosticOperations({
        userId: "*",
        isOwner: true,
      })
      expect(remaining.operations.map((row) => row.id)).not.toContain(a.id)
      expect(remaining.operations.map((row) => row.id)).toContain(b.id)
      expect(
        await exportDiagnosticEvents({
          userId: "diagnostics-user-a",
          isOwner: false,
        })
      ).toEqual([])
    } finally {
      await db
        .deleteFrom("user")
        .where("id", "in", ["diagnostics-user-a", "diagnostics-user-b"])
        .execute()
    }
  })
})
