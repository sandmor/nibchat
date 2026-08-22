import { describe, expect, it } from "vitest"
import {
  GENERATION_STARTING_HANDOFF_MS,
  decideGenerationAttach,
  revertRecoveryState,
  shouldReconcileGeneration,
} from "@/lib/generation-streams/policy"

const now = Date.parse("2026-08-21T18:00:00.000Z")
const startedAt = (ageMs: number) => new Date(now - ageMs).toISOString()

describe("shouldReconcileGeneration", () => {
  it("never recovers an open store", () => {
    expect(
      shouldReconcileGeneration(
        { state: "starting", startedAt: startedAt(60_000) },
        { state: "open" },
        now
      )
    ).toBe(false)
    expect(
      shouldReconcileGeneration(
        { state: "active", startedAt: startedAt(60_000) },
        { state: "open" },
        now
      )
    ).toBe(false)
  })

  it("waits for the starting hand-off when the store is missing", () => {
    expect(
      shouldReconcileGeneration(
        { state: "starting", startedAt: startedAt(1_000) },
        { state: "missing" },
        now
      )
    ).toBe(false)
    expect(
      shouldReconcileGeneration(
        {
          state: "starting",
          startedAt: startedAt(GENERATION_STARTING_HANDOFF_MS + 1),
        },
        { state: "missing" },
        now
      )
    ).toBe(true)
  })

  it("recovers orphaned or closed stores immediately", () => {
    expect(
      shouldReconcileGeneration(
        { state: "starting", startedAt: startedAt(1_000) },
        { state: "orphaned" },
        now
      )
    ).toBe(true)
    expect(
      shouldReconcileGeneration(
        { state: "active", startedAt: startedAt(1_000) },
        { state: "closed" },
        now
      )
    ).toBe(true)
  })

  it("retries leftover recovering rows", () => {
    expect(
      shouldReconcileGeneration(
        { state: "recovering", startedAt: startedAt(1_000) },
        { state: "missing" },
        now
      )
    ).toBe(true)
  })
})

describe("decideGenerationAttach", () => {
  it("subscribes as soon as the store is open", () => {
    expect(
      decideGenerationAttach({
        run: { state: "starting", startedAt: startedAt(1_000) },
        snapshot: { state: "open" },
        now,
      })
    ).toBe("subscribe")
  })

  it("asks the client to retry during the starting hand-off", () => {
    expect(
      decideGenerationAttach({
        run: { state: "starting", startedAt: startedAt(1_000) },
        snapshot: { state: "missing" },
        now,
      })
    ).toBe("retry")
  })

  it("ends attach once a missing starting run is past grace", () => {
    expect(
      decideGenerationAttach({
        run: {
          state: "starting",
          startedAt: startedAt(GENERATION_STARTING_HANDOFF_MS + 1),
        },
        snapshot: { state: "missing" },
        now,
      })
    ).toBe("unavailable")
  })

  it("treats orphaned and closed streams as terminal for new readers", () => {
    expect(
      decideGenerationAttach({
        run: { state: "active", startedAt: startedAt(1_000) },
        snapshot: { state: "orphaned" },
        now,
      })
    ).toBe("unavailable")
    expect(
      decideGenerationAttach({
        run: { state: "active", startedAt: startedAt(1_000) },
        snapshot: { state: "closed" },
        now,
      })
    ).toBe("unavailable")
  })

  it("reports gone when the durable run has been removed", () => {
    expect(
      decideGenerationAttach({
        run: null,
        snapshot: { state: "open" },
        now,
      })
    ).toBe("gone")
  })
})

describe("revertRecoveryState", () => {
  it("restores a followable state so a store outage can retry", () => {
    expect(revertRecoveryState("starting")).toBe("starting")
    expect(revertRecoveryState("cancel_requested")).toBe("cancel_requested")
    expect(revertRecoveryState("active")).toBe("active")
    expect(revertRecoveryState("recovering")).toBe("active")
  })
})
