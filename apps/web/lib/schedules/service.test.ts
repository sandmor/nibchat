import { beforeAll, describe, expect, it } from "vitest"
import {
  createBackup,
  createChat,
  createSpace,
  deleteChats,
  deleteNode,
  getWorkspace,
  insertNode,
  resolveSettingsForChat,
} from "@/lib/chat-service"
import { parseBackup } from "@/lib/backup"
import {
  createChatFromTemplate,
  deleteChatTemplate,
  listChatTemplates,
  saveChatTemplateDocument,
} from "@/lib/chat-template-service"
import { db, migrate, toDbBool } from "@/lib/db"
import { resolveActivePath } from "@/lib/domain"
import { generationStreamStore } from "@/lib/generation-streams/default-port"
import { cadenceToJson, type Cadence } from "@/lib/schedules/cadence"
import {
  claimSchedule,
  createChatSchedule,
  createScheduledUserMessage,
  createSchedule,
  listSchedules,
  pendingGenerationsForChat,
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
  const hidden = await createChatFromTemplate({ userId, document })
  await db
    .insertInto("chat_templates")
    .values({
      id,
      user_id: userId,
      name,
      document_json: "{}",
      revision: 0,
      source_json: "{}",
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute()
  await db
    .insertInto("template_chats")
    .values({
      template_id: id,
      chat_id: hidden.chat.id,
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
    .insertInto("scheduled_jobs")
    .values({
      id: input.id,
      user_id: userId,
      name: input.id,
      action_json: JSON.stringify({
        kind: "template",
        templateId: input.templateId,
        spaceId: null,
      }),
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

describe("scheduled generations", () => {
  it("keeps schedules when a bulk chat deletion contains an unknown chat", async () => {
    const chat = await createChat(userId, "Keep")
    const message = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "Keep" }],
    })
    const schedule = await createChatSchedule({
      userId,
      name: "Keep",
      chatId: chat.id,
      parentId: message.id,
      at: "2099-01-01T12:00:00.000Z",
      timeZone: "UTC",
    })
    await expect(deleteChats(userId, [chat.id, "missing"])).rejects.toThrow(
      /not found/i
    )
    expect(
      await db
        .selectFrom("chats")
        .select("id")
        .where("id", "=", chat.id)
        .executeTakeFirst()
    ).toBeDefined()
    expect(
      (await listSchedules(userId)).schedules.some(
        (item) => item.id === schedule.id
      )
    ).toBe(true)
    await deleteChats(userId, [chat.id])
  })

  it("removes template schedules with the template", async () => {
    const templateId = `template-${crypto.randomUUID()}`
    await insertTemplate(templateId, userBranch)
    const schedule = await createSchedule({
      userId,
      name: "Remove",
      templateId,
      cadence: { kind: "daily", hour: 9, minute: 0, timeZone: "UTC" },
    })
    await deleteChatTemplate(userId, templateId)
    expect(
      (await listSchedules(userId)).schedules.some(
        (item) => item.id === schedule.id
      )
    ).toBe(false)
  })

  it("runs now alongside another generation in the same chat", async () => {
    const chat = await createChat(userId, "Busy")
    const message = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "Ask" }],
    })
    const schedule = await createChatSchedule({
      userId,
      name: "Later",
      chatId: chat.id,
      parentId: message.id,
      at: "2099-01-01T12:00:00.000Z",
      timeZone: "UTC",
    })
    const generationId = crypto.randomUUID()
    const assistant = await insertNode({
      chatId: chat.id,
      parentId: message.id,
      role: "assistant",
      parts: [],
      status: "streaming",
      generationId,
    })
    let called = false
    await runScheduleNow(userId, schedule.id, async (input) => {
      called = true
      await input.afterFinalize?.({ outcome: "complete", parts: [] })
      return new Response(null)
    })
    expect(called).toBe(true)
    expect(
      await db
        .selectFrom("scheduled_job_runs")
        .select("status")
        .where("schedule_id", "=", schedule.id)
        .execute()
    ).toEqual([])
    expect(
      await db
        .selectFrom("generation_runs")
        .select("id")
        .where("id", "=", generationId)
        .executeTakeFirst()
    ).toBeDefined()
    await db
      .deleteFrom("generation_runs")
      .where("id", "=", generationId)
      .execute()
    await db
      .deleteFrom("message_nodes")
      .where("id", "=", assistant.id)
      .execute()
    await deleteChats(userId, [chat.id])
  })

  it("tracks overlapping runs of the same schedule independently", async () => {
    const templateId = `overlap-template-${crypto.randomUUID()}`
    await insertTemplate(templateId, userBranch)
    const schedule = await createSchedule({
      userId,
      name: "Overlap",
      templateId,
      cadence: { kind: "daily", hour: 9, minute: 0, timeZone: "UTC" },
    })
    const finishes: Array<
      NonNullable<Parameters<ScheduleContinuation>[0]["afterFinalize"]>
    > = []
    const continuation: ScheduleContinuation = async (input) => {
      finishes.push(input.afterFinalize!)
      return new Response(null)
    }
    await runScheduleNow(userId, schedule.id, continuation)
    await runScheduleNow(userId, schedule.id, continuation)
    expect(finishes).toHaveLength(2)
    await finishes[1]!({ outcome: "complete", parts: [] })
    let runs = await db
      .selectFrom("scheduled_job_runs")
      .select(["status", "scheduled_for"])
      .where("schedule_id", "=", schedule.id)
      .orderBy("scheduled_for")
      .execute()
    expect(runs.map((run) => run.status)).toEqual(["running", "complete"])
    expect(runs[0]!.scheduled_for).not.toBe(runs[1]!.scheduled_for)
    await finishes[0]!({ outcome: "error", parts: [] })
    runs = await db
      .selectFrom("scheduled_job_runs")
      .select(["status", "scheduled_for"])
      .where("schedule_id", "=", schedule.id)
      .orderBy("scheduled_for")
      .execute()
    expect(runs.map((run) => run.status)).toEqual(["error", "complete"])
    expect(
      (await listSchedules(userId)).schedules.find(
        (item) => item.id === schedule.id
      )?.lastStatus
    ).toBe("complete")
  })

  it("generates from an existing user message without selecting a new branch", async () => {
    const chat = await createChat(userId, "Delayed")
    const message = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "Already said" }],
      attachSelection: false,
    })
    const schedule = await createChatSchedule({
      userId,
      name: "Later",
      chatId: chat.id,
      parentId: message.id,
      at: "2099-01-01T12:00:00.000Z",
      timeZone: "UTC",
    })
    let generatedFrom: string | null = null
    const result = await runScheduleNow(userId, schedule.id, async (input) => {
      generatedFrom = input.parentId
      await input.afterFinalize?.({ outcome: "complete", parts: [] })
      return new Response(null)
    })
    expect(generatedFrom).toBe(message.id)
    expect(
      (
        await db
          .selectFrom("message_nodes")
          .select("id")
          .where("chat_id", "=", chat.id)
          .where("role", "=", "user")
          .execute()
      ).map((row) => row.id)
    ).toEqual([message.id])
    expect(
      (
        await db
          .selectFrom("chats")
          .select("selected_root_node_id")
          .where("id", "=", chat.id)
          .executeTakeFirstOrThrow()
      ).selected_root_node_id
    ).toBeNull()
    expect(result).toBeNull()
    expect(
      await db
        .selectFrom("scheduled_jobs")
        .select("id")
        .where("id", "=", schedule.id)
        .executeTakeFirst()
    ).toBeUndefined()
  })

  it("creates the user message and its generation together", async () => {
    const chat = await createChat(userId, "Deferred send")
    await expect(
      createScheduledUserMessage({
        userId,
        name: "Too late",
        chatId: chat.id,
        parentId: null,
        parts: [{ type: "text", text: "Missed" }],
        at: "2020-01-01T00:00:00.000Z",
        timeZone: "UTC",
      })
    ).rejects.toThrow(/future/)
    expect(
      await db
        .selectFrom("message_nodes")
        .select("id")
        .where("chat_id", "=", chat.id)
        .execute()
    ).toEqual([])
    expect(
      await db
        .selectFrom("scheduled_jobs")
        .select("id")
        .where("user_id", "=", userId)
        .where("name", "=", "Too late")
        .execute()
    ).toEqual([])

    const message = await createScheduledUserMessage({
      userId,
      name: "Ask later",
      chatId: chat.id,
      parentId: null,
      parts: [{ type: "text", text: "Ask later" }],
      at: "2099-01-01T12:00:00.000Z",
      timeZone: "UTC",
    })
    expect(message.role).toBe("user")
    const stored = await db
      .selectFrom("scheduled_jobs")
      .select(["id", "name", "action_json"])
      .where("user_id", "=", userId)
      .where("name", "=", "Ask later")
      .executeTakeFirstOrThrow()
    expect(JSON.parse(stored.action_json)).toMatchObject({
      kind: "chat_generate",
      chatId: chat.id,
      parentId: message.id,
    })
    await db.deleteFrom("scheduled_jobs").where("id", "=", stored.id).execute()
  })

  it("keeps a once generation when the run fails or waits for input", async () => {
    const chat = await createChat(userId, "Needs attention")
    const message = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "Ask" }],
      attachSelection: false,
    })
    const failed = await createChatSchedule({
      userId,
      name: "Failed",
      chatId: chat.id,
      parentId: message.id,
      at: "2099-01-01T12:00:00.000Z",
      timeZone: "UTC",
    })
    const waiting = await createChatSchedule({
      userId,
      name: "Waiting",
      chatId: chat.id,
      parentId: message.id,
      at: "2099-01-02T12:00:00.000Z",
      timeZone: "UTC",
    })
    const failedResult = await runScheduleNow(
      userId,
      failed.id,
      async (input) => {
        await input.afterFinalize?.({ outcome: "error", parts: [] })
        return new Response(null)
      }
    )
    const waitingResult = await runScheduleNow(
      userId,
      waiting.id,
      async (input) => {
        await input.afterFinalize?.({ outcome: "awaiting_input", parts: [] })
        return new Response(null)
      }
    )
    expect(failedResult?.lastStatus).toBe("error")
    expect(waitingResult?.lastStatus).toBe("awaiting_input")
    expect(
      (await listSchedules(userId)).schedules
        .filter((row) => row.id === failed.id || row.id === waiting.id)
        .map((row) => row.id)
        .sort()
    ).toEqual([failed.id, waiting.id].sort())
  })

  it("adds another pending generation from the same user message", async () => {
    const chat = await createChat(userId, "Once")
    const message = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "Ask" }],
      attachSelection: false,
    })
    const first = await createChatSchedule({
      userId,
      name: "Later",
      chatId: chat.id,
      parentId: message.id,
      at: "2099-01-01T12:00:00.000Z",
      timeZone: "UTC",
    })
    const second = await createChatSchedule({
      userId,
      name: "Moved",
      chatId: chat.id,
      parentId: message.id,
      at: "2099-06-01T15:00:00.000Z",
      timeZone: "UTC",
    })
    expect(second.id).not.toBe(first.id)
    expect(second.nextRunAt).not.toBe(first.nextRunAt)
    const pending = (await listSchedules(userId)).schedules.filter(
      (row) => row.action.kind === "chat_generate" && row.nextRunAt
    )
    expect(pending.map((row) => row.id).sort()).toEqual(
      [first.id, second.id].sort()
    )
    expect(pending.find((row) => row.id === first.id)?.nextRunAt).toBe(
      first.nextRunAt
    )
    expect(pending.find((row) => row.id === second.id)?.name).toBe("Moved")
    expect(
      (await pendingGenerationsForChat(userId, chat.id))
        .map((row) => row.id)
        .sort()
    ).toEqual([first.id, second.id].sort())
    const workspace = await getWorkspace(userId, { chatId: chat.id })
    expect(
      workspace.nodes
        .find((node) => node.id === message.id)
        ?.schedules?.map((schedule) => schedule.id)
        .sort()
    ).toEqual([first.id, second.id].sort())
  })

  it("rejects a generation scheduled from an assistant message", async () => {
    const chat = await createChat(userId, "Assistant parent")
    const assistant = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "assistant",
      parts: [{ type: "text", text: "Hi" }],
      attachSelection: false,
    })
    await expect(
      createChatSchedule({
        userId,
        name: "Later",
        chatId: chat.id,
        parentId: assistant.id,
        at: "2099-01-01T12:00:00.000Z",
        timeZone: "UTC",
      })
    ).rejects.toThrow("A generation can only be scheduled from a user message.")
  })

  it("generates from a user message that already has a reply", async () => {
    const chat = await createChat(userId, "Branched")
    const message = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "Ask" }],
      attachSelection: false,
    })
    await insertNode({
      chatId: chat.id,
      parentId: message.id,
      role: "assistant",
      parts: [{ type: "text", text: "Answer" }],
      attachSelection: false,
    })
    const schedule = await createChatSchedule({
      userId,
      name: "Again",
      chatId: chat.id,
      parentId: message.id,
      at: "2099-01-01T12:00:00.000Z",
      timeZone: "UTC",
    })
    let generatedFrom: string | null = null
    await runScheduleNow(userId, schedule.id, async (input) => {
      generatedFrom = input.parentId
      await input.afterFinalize?.({ outcome: "complete", parts: [] })
      return new Response(null)
    })
    expect(generatedFrom).toBe(message.id)
  })

  it("drops a chat schedule when its user message is deleted", async () => {
    const chat = await createChat(userId, "Removed")
    const message = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "Gone" }],
      attachSelection: false,
    })
    const schedule = await createChatSchedule({
      userId,
      name: "Later",
      chatId: chat.id,
      parentId: message.id,
      at: "2099-01-01T12:00:00.000Z",
      timeZone: "UTC",
    })
    await deleteNode(userId, message.id, "subtree")
    const listed = await listSchedules(userId)
    expect(
      listed.schedules.find((item) => item.id === schedule.id)
    ).toBeUndefined()
  })

  it("lets only one claim win", async () => {
    await insertTemplate("claim-template", userBranch)
    await insertDueSchedule({
      id: "claim-schedule",
      templateId: "claim-template",
      nextRunAt: "2026-01-01T09:00:00.000Z",
    })
    const row = await db
      .selectFrom("scheduled_jobs")
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
      .selectFrom("scheduled_jobs")
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
    const calls: Array<{
      chatId: string
      parentId: string | null
      timeZone: string
    }> = []
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
      .selectFrom("scheduled_jobs")
      .selectAll()
      .where("id", "=", "fire-schedule")
      .executeTakeFirstOrThrow()
    expect(schedule.last_status).toBe("complete")
    expect(schedule.last_chat_id).toBe(chat.id)
    expect(schedule.next_run_at).toBe("2026-01-02T09:00:00.000Z")
    expect(chat.title).toBeNull()
  })

  it("drops a once template schedule after a successful run", async () => {
    await insertTemplate("once-template", userBranch, "Once")
    const timestamp = "2026-01-01T00:00:00.000Z"
    await db
      .insertInto("scheduled_jobs")
      .values({
        id: "once-fire",
        user_id: userId,
        name: "Once",
        action_json: JSON.stringify({
          kind: "template",
          templateId: "once-template",
          spaceId: null,
        }),
        cadence_json: cadenceToJson({
          kind: "once",
          at: "2026-01-01T09:00:00.000Z",
          timeZone: "UTC",
        }),
        enabled: toDbBool(true),
        next_run_at: "2026-01-01T09:00:00.000Z",
        last_run_at: null,
        last_status: null,
        last_error: null,
        last_chat_id: null,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .execute()
    let chatId: string | null = null
    await runScheduleTick(
      new Date("2026-01-01T10:00:00.000Z"),
      async (input) => {
        chatId = input.chatId
        await input.afterFinalize?.({ outcome: "complete", parts: [] })
        return new Response(null)
      }
    )
    expect(chatId).toBeTruthy()
    expect(
      await db
        .selectFrom("scheduled_jobs")
        .select("id")
        .where("id", "=", "once-fire")
        .executeTakeFirst()
    ).toBeUndefined()
    expect(
      await db
        .selectFrom("chats")
        .select("id")
        .where("id", "=", chatId)
        .executeTakeFirst()
    ).toBeTruthy()
  })

  it("records an error when the template branch no longer ends on a user message", async () => {
    await insertTemplate("stale-template", userBranch)
    await insertDueSchedule({
      id: "stale-schedule",
      templateId: "stale-template",
      nextRunAt: "2026-01-01T09:00:00.000Z",
    })
    await saveChatTemplateDocument({
      userId,
      templateId: "stale-template",
      name: "stale-template",
      document: assistantOnly,
    })
    let called = false
    await runScheduleTick(new Date("2026-01-01T10:00:00.000Z"), async () => {
      called = true
      return new Response(null)
    })
    expect(called).toBe(false)
    const schedule = await db
      .selectFrom("scheduled_jobs")
      .selectAll()
      .where("id", "=", "stale-schedule")
      .executeTakeFirstOrThrow()
    expect(schedule.last_status).toBe("error")
    expect(schedule.last_error).toMatch(/user message/)
    expect(schedule.last_chat_id).toBeNull()
  })

  it("runs a due template while its previous chat is generating", async () => {
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
        async (input) => {
          await input.afterFinalize?.({ outcome: "complete", parts: [] })
          return new Response(null)
        }
      )
    } finally {
      await generationStreamStore.discard(generationId)
    }
    const schedule = await db
      .selectFrom("scheduled_jobs")
      .selectAll()
      .where("id", "=", "skip-schedule")
      .executeTakeFirstOrThrow()
    expect(schedule.next_run_at).toBe("2026-01-02T09:00:00.000Z")
    expect(schedule.last_status).toBe("complete")
    const chats = await db
      .selectFrom("chats")
      .selectAll()
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
    await db
      .insertInto("scheduled_job_runs")
      .values({
        id: "restart-run-row",
        schedule_id: "restart-schedule",
        scheduled_for: "2025-12-30T09:00:00.000Z",
        started_at: "2026-01-01T08:00:00.000Z",
        finished_at: null,
        status: "running",
        error: null,
        chat_id: oldChat.id,
        message_id: assistant.id,
      })
      .execute()

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
      .selectFrom("scheduled_jobs")
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
    await db
      .insertInto("scheduled_job_runs")
      .values({
        id: "interrupt-run",
        schedule_id: "interrupt-schedule",
        scheduled_for: "2026-01-01T09:00:00.000Z",
        started_at: "2026-01-01T09:00:00.000Z",
        finished_at: null,
        status: "running",
        error: null,
        chat_id: null,
        message_id: null,
      })
      .execute()
    await reconcileInterruptedSchedules()
    const schedule = await db
      .selectFrom("scheduled_jobs")
      .selectAll()
      .where("id", "=", "interrupt-schedule")
      .executeTakeFirstOrThrow()
    expect(schedule.last_status).toBe("error")
    expect(schedule.last_error).toMatch(/interrupted/)
  })

  it("reconciles one interrupted run while another run in the chat stays active", async () => {
    const chat = await createChat(userId, "Parallel recovery")
    const staleId = crypto.randomUUID()
    const activeId = crypto.randomUUID()
    const stale = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "assistant",
      parts: [],
      status: "streaming",
      generationId: staleId,
    })
    const active = await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "assistant",
      parts: [],
      status: "streaming",
      generationId: activeId,
    })
    await db
      .updateTable("generation_runs")
      .set({ state: "active", started_at: "2026-01-01T00:00:00.000Z" })
      .where("id", "=", staleId)
      .execute()
    await generationStreamStore.open({
      generationId: activeId,
      nodeId: active.id,
      chatId: chat.id,
      parentNodeId: null,
    })
    await db
      .updateTable("generation_runs")
      .set({ state: "active" })
      .where("id", "=", activeId)
      .execute()
    const templateId = `recovery-template-${crypto.randomUUID()}`
    await insertTemplate(templateId, userBranch)
    const schedule = await createSchedule({
      userId,
      name: "Recovery",
      templateId,
      cadence: { kind: "daily", hour: 9, minute: 0, timeZone: "UTC" },
    })
    const base = {
      schedule_id: schedule.id,
      finished_at: null,
      status: "running" as const,
      error: null,
      chat_id: chat.id,
    }
    await db
      .insertInto("scheduled_job_runs")
      .values([
        {
          ...base,
          id: staleId,
          scheduled_for: "2026-01-01T09:00:00.000Z",
          started_at: "2026-01-01T09:00:00.000Z",
          message_id: stale.id,
        },
        {
          ...base,
          id: activeId,
          scheduled_for: "2026-01-02T09:00:00.000Z",
          started_at: "2026-01-02T09:00:00.000Z",
          message_id: active.id,
        },
      ])
      .execute()
    try {
      await reconcileInterruptedSchedules()
      const runs = await db
        .selectFrom("scheduled_job_runs")
        .select(["id", "status"])
        .where("schedule_id", "=", schedule.id)
        .execute()
      expect(runs.find((run) => run.id === staleId)?.status).toBe("error")
      expect(runs.find((run) => run.id === activeId)?.status).toBe("running")
    } finally {
      await generationStreamStore.discard(activeId)
      await db
        .deleteFrom("scheduled_jobs")
        .where("id", "=", schedule.id)
        .execute()
      await db
        .deleteFrom("generation_runs")
        .where("id", "=", activeId)
        .execute()
      await deleteChats(userId, [chat.id])
    }
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
        .updateTable("scheduled_jobs")
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
      expectedFingerprint: (await listChatTemplates(userId)).find(
        (template) => template.id === created.templateId
      )!.fingerprint,
      cadence: { ...cadence, hour: 8 },
    })
    expect(replaced.schedules).toHaveLength(1)
    expect(replaced.schedules[0]?.id).toBe(created.schedules[0]?.id)
    expect(replaced.schedules[0]?.cadence).toMatchObject({ hour: 8 })
    const rows = await db.selectFrom("scheduled_jobs").selectAll().execute()
    expect(
      rows.filter(
        (row) => JSON.parse(row.action_json).templateId === created.templateId
      )
    ).toHaveLength(1)
  })

  it("keeps chat overrides while inheriting current space settings on every run", async () => {
    const space = await createSpace({
      userId,
      name: "Recurring settings",
      settings: { topP: { mode: "default", value: 0.8 } },
    })
    const chat = await createChat(
      userId,
      "Recurring settings",
      { temperature: 0.37, maxOutputTokens: 321 },
      space.id
    )
    await insertNode({
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "Repeat this" }],
    })
    const { schedules } = await scheduleFromChat({
      userId,
      chatId: chat.id,
      name: "Recurring settings",
      spaceId: space.id,
      cadence: { kind: "daily", hour: 9, minute: 0, timeZone: "UTC" },
    })
    const temperatures: number[] = []
    const topPs: number[] = []
    for (let run = 0; run < 2; run++) {
      await runScheduleNow(userId, schedules[0]!.id, async (input) => {
        const created = await db
          .selectFrom("chats")
          .selectAll()
          .where("id", "=", input.chatId)
          .executeTakeFirstOrThrow()
        const overrides = JSON.parse(created.settings_json)
        expect(overrides).toMatchObject({
          temperature: 0.37,
          maxOutputTokens: 321,
        })
        expect(overrides.topP).toBeUndefined()
        const effective = (await resolveSettingsForChat(created, userId))
          .effective.values
        temperatures.push(effective.temperature!)
        topPs.push(effective.topP!)
        await input.afterFinalize?.({ outcome: "complete", parts: [] })
        return new Response(null)
      })
      if (run === 0) {
        await db
          .updateTable("chats")
          .set({ settings_json: JSON.stringify({ temperature: 0.8 }) })
          .where("id", "=", chat.id)
          .execute()
        await db
          .updateTable("spaces")
          .set({
            settings_json: JSON.stringify({
              topP: { mode: "default", value: 0.6 },
            }),
          })
          .where("id", "=", space.id)
          .execute()
      }
    }
    expect(temperatures).toEqual([0.37, 0.37])
    expect(topPs).toEqual([0.8, 0.6])
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
    expect(result?.nextRunAt).toBe("2026-05-01T09:00:00.000Z")
    expect(result?.lastStatus).toBe("complete")
    expect(result?.lastChatId).toBeTruthy()
  })
})
