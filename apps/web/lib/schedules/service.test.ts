import { beforeAll, describe, expect, it } from "vitest"
import { createBackup } from "@/lib/chat-service"
import { parseBackup } from "@/lib/backup"
import { createChat, insertNode } from "@/lib/chat-service"
import { db, migrate, toDbBool } from "@/lib/db"
import { resolveActivePath } from "@/lib/domain"
import { generationStreamStore } from "@/lib/generation-streams/default-port"
import { cadenceToJson, type Cadence } from "@/lib/schedules/cadence"
import {
  claimSchedule,
  createSchedule,
  reconcileInterruptedSchedules,
  runScheduleNow,
  runScheduleTick,
  scheduleFromChat,
  updateSchedule,
  type ScheduleContinuation,
} from "@/lib/schedules/service"

const userId = "schedule-owner"

const userBranch = {
  version: 1 as const,
  selectedRootId: "u1",
  expandMessageMacros: false,
  nodes: [
    {
      id: "u1",
      parentId: null,
      selectedChildId: "a1",
      sortKey: 1,
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Ask" }],
      excludedFromContext: false,
    },
    {
      id: "a1",
      parentId: "u1",
      selectedChildId: "u2",
      sortKey: 1,
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Answer" }],
      excludedFromContext: false,
    },
    {
      id: "u2",
      parentId: "a1",
      selectedChildId: null,
      sortKey: 1,
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Again" }],
      excludedFromContext: false,
    },
    {
      id: "a2",
      parentId: "u1",
      selectedChildId: null,
      sortKey: 2,
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Other" }],
      excludedFromContext: false,
    },
  ],
}

const assistantOnly = {
  version: 1 as const,
  selectedRootId: "a",
  expandMessageMacros: false,
  nodes: [
    {
      id: "a",
      parentId: null,
      selectedChildId: null,
      sortKey: 1,
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Hi" }],
      excludedFromContext: false,
    },
  ],
}

beforeAll(async () => {
  await migrate()
  const existing = await db
    .selectFrom("user")
    .select("id")
    .where("id", "=", userId)
    .executeTakeFirst()
  if (existing) return
  await db
    .insertInto("user")
    .values({
      id: userId,
      name: "Scheduler",
      email: "scheduler@test.local",
      emailVerified: toDbBool(true),
      image: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: "admin",
      banned: toDbBool(false),
      banReason: null,
      banExpires: null,
    })
    .execute()
})

async function insertTemplate(
  id: string,
  document: typeof userBranch | typeof assistantOnly,
  name = id
) {
  const timestamp = new Date().toISOString()
  await db
    .insertInto("chat_templates")
    .values({
      id,
      user_id: userId,
      name,
      document_json: JSON.stringify(document),
      revision: 0,
      source_json: "{}",
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute()
}

async function insertDueSchedule(input: {
  id: string
  templateId: string
  nextRunAt: string
  lastStatus?: "running" | null
  lastChatId?: string | null
}) {
  const timestamp = "2026-01-01T00:00:00.000Z"
  const cadence: Cadence = {
    kind: "daily",
    hour: 9,
    minute: 0,
    timeZone: "UTC",
  }
  await db
    .insertInto("scheduled_generations")
    .values({
      id: input.id,
      user_id: userId,
      template_id: input.templateId,
      space_id: null,
      name: input.id,
      cadence_json: cadenceToJson(cadence),
      enabled: toDbBool(true),
      next_run_at: input.nextRunAt,
      last_run_at: null,
      last_status: input.lastStatus ?? null,
      last_error: null,
      last_chat_id: input.lastChatId ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute()
}

function refusingContinuation(): ScheduleContinuation {
  return async () => {
    throw new Error("generation should not start")
  }
}

describe("scheduled generations", () => {
  it("lets only one claim win", async () => {
    await insertTemplate("claim-template", userBranch)
    await insertDueSchedule({
      id: "claim-schedule",
      templateId: "claim-template",
      nextRunAt: "2026-01-01T09:00:00.000Z",
    })
    const row = await db
      .selectFrom("scheduled_generations")
      .selectAll()
      .where("id", "=", "claim-schedule")
      .executeTakeFirstOrThrow()
    const at = new Date("2026-01-01T10:00:00.000Z")
    const results = await Promise.all([
      claimSchedule(row, at),
      claimSchedule(row, at),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    const after = await db
      .selectFrom("scheduled_generations")
      .selectAll()
      .where("id", "=", "claim-schedule")
      .executeTakeFirstOrThrow()
    expect(after.next_run_at).toBe("2026-01-02T09:00:00.000Z")
    expect(after.last_status).toBe("running")
  })

  it("rejects a template whose saved branch does not end on a user message", async () => {
    await insertTemplate("assistant-template", assistantOnly)
    await expect(
      createSchedule({
        userId,
        name: "Bad",
        templateId: "assistant-template",
        cadence: { kind: "daily", hour: 9, minute: 0, timeZone: "UTC" },
      })
    ).rejects.toThrow(/user message/)
  })

  it("creates a chat on the saved branch and continues from the user leaf", async () => {
    await insertTemplate("fire-template", userBranch, "Morning")
    await insertDueSchedule({
      id: "fire-schedule",
      templateId: "fire-template",
      nextRunAt: "2026-01-01T09:00:00.000Z",
    })
    const calls: Array<{ chatId: string; parentId: string; timeZone: string }> =
      []
    const continueGeneration: ScheduleContinuation = async (input) => {
      calls.push({
        chatId: input.chatId,
        parentId: input.parentId,
        timeZone: input.timeZone,
      })
      await input.afterFinalize?.({ outcome: "complete", parts: [] })
      return new Response(null)
    }
    await runScheduleTick(
      new Date("2026-01-01T10:00:00.000Z"),
      continueGeneration
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]?.timeZone).toBe("UTC")
    const chat = await db
      .selectFrom("chats")
      .selectAll()
      .where("id", "=", calls[0]!.chatId)
      .executeTakeFirstOrThrow()
    const nodes = await db
      .selectFrom("message_nodes")
      .selectAll()
      .where("chat_id", "=", chat.id)
      .execute()
    const path = resolveActivePath(nodes, chat.selected_root_node_id)
    expect(path.map((node) => node.role)).toEqual(["user", "assistant", "user"])
    expect(path.at(-1)?.id).toBe(calls[0]?.parentId)
    expect(nodes).toHaveLength(4)
    const schedule = await db
      .selectFrom("scheduled_generations")
      .selectAll()
      .where("id", "=", "fire-schedule")
      .executeTakeFirstOrThrow()
    expect(schedule.last_status).toBe("complete")
    expect(schedule.last_chat_id).toBe(chat.id)
    expect(schedule.next_run_at).toBe("2026-01-02T09:00:00.000Z")
    expect(chat.title).toContain("Morning")
    expect(chat.title).toContain("UTC")
  })

  it("records an error when the template branch no longer ends on a user message", async () => {
    await insertTemplate("stale-template", userBranch)
    await insertDueSchedule({
      id: "stale-schedule",
      templateId: "stale-template",
      nextRunAt: "2026-01-01T09:00:00.000Z",
    })
    await db
      .updateTable("chat_templates")
      .set({ document_json: JSON.stringify(assistantOnly) })
      .where("id", "=", "stale-template")
      .execute()
    let called = false
    await runScheduleTick(new Date("2026-01-01T10:00:00.000Z"), async () => {
      called = true
      return new Response(null)
    })
    expect(called).toBe(false)
    const schedule = await db
      .selectFrom("scheduled_generations")
      .selectAll()
      .where("id", "=", "stale-schedule")
      .executeTakeFirstOrThrow()
    expect(schedule.last_status).toBe("error")
    expect(schedule.last_error).toMatch(/user message/)
    expect(schedule.last_chat_id).toBeTruthy()
  })

  it("skips a due run while the previous generation is still active", async () => {
    await insertTemplate("skip-template", userBranch)
    const chat = await createChat(userId, "Busy")
    const generationId = "skip-run"
    const node = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "assistant",
      parts: [],
      status: "streaming",
      generationId,
    })
    await generationStreamStore.open({
      generationId,
      nodeId: node.id,
      chatId: chat.id,
      parentNodeId: null,
    })
    await db
      .updateTable("generation_runs")
      .set({ state: "active", started_at: "2026-01-01T09:00:00.000Z" })
      .where("id", "=", generationId)
      .execute()
    await insertDueSchedule({
      id: "skip-schedule",
      templateId: "skip-template",
      nextRunAt: "2026-01-01T09:00:00.000Z",
      lastStatus: "running",
      lastChatId: chat.id,
    })
    try {
      await runScheduleTick(
        new Date("2026-01-01T10:00:00.000Z"),
        refusingContinuation()
      )
    } finally {
      await generationStreamStore.discard(generationId)
    }
    const schedule = await db
      .selectFrom("scheduled_generations")
      .selectAll()
      .where("id", "=", "skip-schedule")
      .executeTakeFirstOrThrow()
    expect(schedule.next_run_at).toBe("2026-01-01T09:00:00.000Z")
    expect(schedule.last_status).toBe("skipped")
    const chats = await db
      .selectFrom("chats")
      .select("id")
      .where("user_id", "=", userId)
      .where("title", "=", "Busy")
      .execute()
    expect(chats).toHaveLength(1)
  })

  it("reconciles a stale generation before running the next occurrence", async () => {
    await insertTemplate("restart-template", userBranch)
    const oldChat = await createChat(userId, "Interrupted")
    const generationId = "restart-run"
    const assistant = await insertNode({
      chatId: oldChat.id,
      parentId: null,
      role: "assistant",
      parts: [{ type: "text", text: "partial" }],
      status: "streaming",
      generationId,
    })
    await db
      .updateTable("generation_runs")
      .set({ state: "active", started_at: "2026-01-01T08:00:00.000Z" })
      .where("id", "=", generationId)
      .execute()
    await insertDueSchedule({
      id: "restart-schedule",
      templateId: "restart-template",
      nextRunAt: "2025-12-31T09:00:00.000Z",
      lastStatus: "running",
      lastChatId: oldChat.id,
    })

    let called = false
    await runScheduleTick(
      new Date("2026-01-01T10:00:00.000Z"),
      async (input) => {
        called = true
        await input.afterFinalize?.({ outcome: "complete", parts: [] })
        return new Response(null)
      }
    )

    expect(called).toBe(true)
    expect(
      await db
        .selectFrom("generation_runs")
        .select("id")
        .where("id", "=", generationId)
        .executeTakeFirst()
    ).toBeUndefined()
    expect(
      await db
        .selectFrom("message_nodes")
        .select("status")
        .where("id", "=", assistant.id)
        .executeTakeFirstOrThrow()
    ).toMatchObject({ status: "error" })
    const schedule = await db
      .selectFrom("scheduled_generations")
      .selectAll()
      .where("id", "=", "restart-schedule")
      .executeTakeFirstOrThrow()
    expect(schedule.last_status).toBe("complete")
    expect(schedule.last_chat_id).not.toBe(oldChat.id)
    expect(schedule.next_run_at).toBe("2026-01-02T09:00:00.000Z")
  })

  it("marks a running schedule interrupted when its generation is gone", async () => {
    await insertTemplate("interrupt-template", userBranch)
    await insertDueSchedule({
      id: "interrupt-schedule",
      templateId: "interrupt-template",
      nextRunAt: "2026-02-01T09:00:00.000Z",
      lastStatus: "running",
    })
    await reconcileInterruptedSchedules()
    const schedule = await db
      .selectFrom("scheduled_generations")
      .selectAll()
      .where("id", "=", "interrupt-schedule")
      .executeTakeFirstOrThrow()
    expect(schedule.last_status).toBe("error")
    expect(schedule.last_error).toMatch(/interrupted/)
  })

  it("refuses to create or enable a schedule on a stateless server", async () => {
    await insertTemplate("mode-template", userBranch)
    const previous = process.env.GENERATION_RUNTIME_MODE
    process.env.GENERATION_RUNTIME_MODE = "stateless"
    try {
      await expect(
        createSchedule({
          userId,
          name: "Later",
          templateId: "mode-template",
          cadence: { kind: "daily", hour: 9, minute: 0, timeZone: "UTC" },
        })
      ).rejects.toThrow(/stateful/)
      await insertDueSchedule({
        id: "mode-schedule",
        templateId: "mode-template",
        nextRunAt: "2026-03-01T09:00:00.000Z",
      })
      await db
        .updateTable("scheduled_generations")
        .set({ enabled: toDbBool(false) })
        .where("id", "=", "mode-schedule")
        .execute()
      await expect(
        updateSchedule({
          userId,
          id: "mode-schedule",
          enabled: true,
        })
      ).rejects.toThrow(/stateful/)
    } finally {
      if (previous === undefined) delete process.env.GENERATION_RUNTIME_MODE
      else process.env.GENERATION_RUNTIME_MODE = previous
    }
  })

  it("includes schedules in a backup", async () => {
    await insertTemplate("backup-template", userBranch)
    await insertDueSchedule({
      id: "backup-schedule",
      templateId: "backup-template",
      nextRunAt: "2026-04-01T09:00:00.000Z",
    })
    const backup = parseBackup(await createBackup())
    const row = backup.scheduledGenerations.find(
      (schedule) => schedule.id === "backup-schedule"
    )
    expect(row?.enabled).toBe(true)
    expect(row?.cadence_json).toContain("daily")
  })

  it("saves the chat branch and one schedule, then updates that schedule on replace", async () => {
    const chat = await createChat(userId, "Digest")
    await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "Go" }],
    })
    const cadence = {
      kind: "daily" as const,
      hour: 9,
      minute: 0,
      timeZone: "America/Chicago",
    }
    const created = await scheduleFromChat({
      userId,
      chatId: chat.id,
      name: "Digest",
      cadence,
    })
    expect(created.schedules).toHaveLength(1)
    expect(created.schedules[0]?.cadence).toMatchObject(cadence)
    const replaced = await scheduleFromChat({
      userId,
      chatId: chat.id,
      name: "Digest",
      templateId: created.templateId,
      expectedRevision: 0,
      cadence: { ...cadence, hour: 8 },
    })
    expect(replaced.schedules).toHaveLength(1)
    expect(replaced.schedules[0]?.id).toBe(created.schedules[0]?.id)
    expect(replaced.schedules[0]?.cadence).toMatchObject({ hour: 8 })
    const rows = await db
      .selectFrom("scheduled_generations")
      .select("id")
      .where("template_id", "=", created.templateId)
      .execute()
    expect(rows).toHaveLength(1)
  })

  it("runs now in the schedule time zone without moving the next slot", async () => {
    await insertTemplate("now-template", userBranch)
    await insertDueSchedule({
      id: "now-schedule",
      templateId: "now-template",
      nextRunAt: "2026-05-01T09:00:00.000Z",
    })
    const calls: string[] = []
    const result = await runScheduleNow(
      userId,
      "now-schedule",
      async (input) => {
        calls.push(input.timeZone)
        await input.afterFinalize?.({ outcome: "complete", parts: [] })
        return new Response(null)
      }
    )
    expect(calls).toEqual(["UTC"])
    expect(result.nextRunAt).toBe("2026-05-01T09:00:00.000Z")
    expect(result.lastStatus).toBe("complete")
    expect(result.lastChatId).toBeTruthy()
  })
})
