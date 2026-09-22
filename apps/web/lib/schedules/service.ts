import "server-only"
import type { GenerationSetup } from "@/lib/agent/run-generation"
import { reconcileChatGenerationRuns } from "@/lib/chat-service"
import {
  createChatFromTemplate,
  saveChatTemplateFromChat,
} from "@/lib/chat-template-service"
import {
  parseChatTemplateDocument,
  templateActiveLeaf,
} from "@/lib/chat-template"
import { db, fromDbBool, migrate, toDbBool } from "@/lib/db"
import { id, now, resolveActivePath } from "@/lib/domain"
import { MAX_NAME } from "@/lib/limits"
import type { ScheduleRunStatus, ScheduledGenerationRow } from "@/lib/types"
import {
  cadenceInputSchema,
  cadenceToJson,
  followingRunAt,
  parseCadence,
  storeCadence,
  type Cadence,
  type CadenceInput,
} from "@/lib/schedules/cadence"

const USER_LEAF = "The saved template branch must end on a user message."
const STATELESS = "Scheduled generations run only on a stateful server."
const INTERRUPTED = "The scheduled generation was interrupted."

export function schedulesAvailable() {
  return process.env.GENERATION_RUNTIME_MODE !== "stateless"
}

function assertSchedulesAvailable() {
  if (!schedulesAvailable()) throw new Error(STATELESS)
}

function assertUserLeaf(
  document: ReturnType<typeof parseChatTemplateDocument>
) {
  if (templateActiveLeaf(document)?.role !== "user") throw new Error(USER_LEAF)
}

async function ownedTemplate(userId: string, templateId: string) {
  const row = await db
    .selectFrom("chat_templates")
    .selectAll()
    .where("id", "=", templateId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!row) throw new Error("Chat template not found")
  return row
}

async function assertSpaceOwner(userId: string, spaceId: string | null) {
  if (!spaceId) return
  const space = await db
    .selectFrom("spaces")
    .select("id")
    .where("id", "=", spaceId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!space) throw new Error("Space not found")
}

function chatTitle(templateName: string, at: Date) {
  const stamp = at.toISOString().slice(0, 16).replace("T", " ")
  const title = `${templateName} · ${stamp} UTC`
  return title.length <= MAX_NAME ? title : title.slice(0, MAX_NAME)
}

function errorText(error: unknown) {
  const message =
    error instanceof Error && error.message
      ? error.message
      : "The scheduled generation failed."
  return message.slice(0, 500)
}

function statusForOutcome(
  outcome: "complete" | "awaiting_input" | "aborted" | "error"
): ScheduleRunStatus {
  if (outcome === "complete") return "complete"
  if (outcome === "awaiting_input") return "awaiting_input"
  return "error"
}

export type ScheduleView = {
  id: string
  name: string
  templateId: string
  templateName: string
  spaceId: string | null
  cadence: Cadence
  enabled: boolean
  nextRunAt: string
  lastRunAt: string | null
  lastStatus: ScheduleRunStatus | null
  lastError: string | null
  lastChatId: string | null
}

function toView(
  row: ScheduledGenerationRow & { template_name: string }
): ScheduleView {
  return {
    id: row.id,
    name: row.name,
    templateId: row.template_id,
    templateName: row.template_name,
    spaceId: row.space_id,
    cadence: parseCadence(row.cadence_json),
    enabled: fromDbBool(row.enabled),
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    lastChatId: row.last_chat_id,
  }
}

export async function listSchedules(userId: string) {
  const rows = await db
    .selectFrom("scheduled_generations")
    .innerJoin(
      "chat_templates",
      "chat_templates.id",
      "scheduled_generations.template_id"
    )
    .selectAll("scheduled_generations")
    .select("chat_templates.name as template_name")
    .where("scheduled_generations.user_id", "=", userId)
    .orderBy("scheduled_generations.created_at")
    .execute()
  return {
    available: schedulesAvailable(),
    schedules: rows.map((row) => toView(row)),
  }
}

export async function createSchedule(input: {
  userId: string
  name: string
  templateId: string
  spaceId?: string | null
  cadence: CadenceInput
}) {
  assertSchedulesAvailable()
  const name = input.name.trim()
  if (!name || name.length > MAX_NAME) throw new Error("Name is required")
  const cadenceInput = cadenceInputSchema.parse(input.cadence)
  const template = await ownedTemplate(input.userId, input.templateId)
  const document = parseChatTemplateDocument(template.document_json)
  assertUserLeaf(document)
  const spaceId = input.spaceId ?? null
  await assertSpaceOwner(input.userId, spaceId)
  const created = new Date()
  const cadence = storeCadence(cadenceInput, created)
  const timestamp = created.toISOString()
  const row = {
    id: id(),
    user_id: input.userId,
    template_id: template.id,
    space_id: spaceId,
    name,
    cadence_json: cadenceToJson(cadence),
    enabled: toDbBool(true),
    next_run_at: followingRunAt(cadence, created).toISOString(),
    last_run_at: null,
    last_status: null,
    last_error: null,
    last_chat_id: null,
    created_at: timestamp,
    updated_at: timestamp,
  }
  await db.insertInto("scheduled_generations").values(row).execute()
  return (await listSchedules(input.userId)).schedules.find(
    (schedule) => schedule.id === row.id
  )!
}

export async function updateSchedule(input: {
  userId: string
  id: string
  name?: string
  spaceId?: string | null
  cadence?: CadenceInput
  enabled?: boolean
}) {
  const existing = await db
    .selectFrom("scheduled_generations")
    .selectAll()
    .where("id", "=", input.id)
    .where("user_id", "=", input.userId)
    .executeTakeFirst()
  if (!existing) throw new Error("Schedule not found")
  if (input.enabled === true && !fromDbBool(existing.enabled))
    assertSchedulesAvailable()
  const template = await ownedTemplate(input.userId, existing.template_id)
  const document = parseChatTemplateDocument(template.document_json)
  assertUserLeaf(document)
  const spaceId =
    input.spaceId === undefined ? existing.space_id : input.spaceId
  await assertSpaceOwner(input.userId, spaceId)
  const name = input.name === undefined ? existing.name : input.name.trim()
  if (!name || name.length > MAX_NAME) throw new Error("Name is required")
  const current = parseCadence(existing.cadence_json)
  let cadence = current
  if (input.cadence) {
    const next = cadenceInputSchema.parse(input.cadence)
    const anchor =
      next.kind === "interval" && current.kind === "interval"
        ? new Date(current.anchor)
        : new Date()
    cadence = storeCadence(next, anchor)
  }
  const cadenceChanged = cadenceToJson(cadence) !== existing.cadence_json
  const timestamp = now()
  await db
    .updateTable("scheduled_generations")
    .set({
      name,
      template_id: template.id,
      space_id: spaceId,
      cadence_json: cadenceToJson(cadence),
      enabled: toDbBool(
        input.enabled === undefined
          ? fromDbBool(existing.enabled)
          : input.enabled
      ),
      ...(cadenceChanged
        ? { next_run_at: followingRunAt(cadence, new Date()).toISOString() }
        : {}),
      updated_at: timestamp,
    })
    .where("id", "=", existing.id)
    .execute()
  return (await listSchedules(input.userId)).schedules.find(
    (schedule) => schedule.id === existing.id
  )!
}

export async function deleteSchedule(userId: string, scheduleId: string) {
  const result = await db
    .deleteFrom("scheduled_generations")
    .where("id", "=", scheduleId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (Number(result.numDeletedRows ?? 0) === 0)
    throw new Error("Schedule not found")
  return { ok: true as const }
}

async function liveGeneration(chatId: string | null) {
  if (!chatId) return false
  await reconcileChatGenerationRuns(chatId)
  const run = await db
    .selectFrom("generation_runs")
    .select("id")
    .where("chat_id", "=", chatId)
    .executeTakeFirst()
  return Boolean(run)
}

export async function reconcileInterruptedSchedules() {
  const running = await db
    .selectFrom("scheduled_generations")
    .selectAll()
    .where("last_status", "=", "running")
    .execute()
  for (const row of running) {
    if (await liveGeneration(row.last_chat_id)) continue
    await db
      .updateTable("scheduled_generations")
      .set({
        last_status: "error",
        last_error: INTERRUPTED,
        updated_at: now(),
      })
      .where("id", "=", row.id)
      .where("last_status", "=", "running")
      .execute()
  }
}

export async function claimSchedule(
  row: Pick<ScheduledGenerationRow, "id" | "cadence_json" | "next_run_at">,
  at = new Date()
) {
  const cadence = parseCadence(row.cadence_json)
  const result = await db
    .updateTable("scheduled_generations")
    .set({
      next_run_at: followingRunAt(cadence, at).toISOString(),
      last_status: "running",
      last_run_at: at.toISOString(),
      last_error: null,
      updated_at: at.toISOString(),
    })
    .where("id", "=", row.id)
    .where("enabled", "=", toDbBool(true))
    .where("next_run_at", "=", row.next_run_at)
    .executeTakeFirst()
  return Number(result.numUpdatedRows ?? 0) === 1
}

async function recordFinish(
  scheduleId: string,
  status: ScheduleRunStatus,
  lastError: string | null,
  chatId?: string
) {
  await db
    .updateTable("scheduled_generations")
    .set({
      last_status: status,
      last_error: lastError,
      ...(chatId ? { last_chat_id: chatId } : {}),
      updated_at: now(),
    })
    .where("id", "=", scheduleId)
    .execute()
}

export type ScheduleContinuation = (input: {
  userId: string
  chatId: string
  parentId: string
  timeZone: string
  requestSignal: AbortSignal
  attachSelection: boolean
  afterFinalize?: GenerationSetup["afterFinalize"]
}) => Promise<Response>

async function defaultContinuation(input: Parameters<ScheduleContinuation>[0]) {
  const { continueChatGeneration } = await import("@/lib/agent/open-generation")
  return continueChatGeneration(input)
}

export async function fireSchedule(
  scheduleId: string,
  continueGeneration: ScheduleContinuation = defaultContinuation
) {
  const row = await db
    .selectFrom("scheduled_generations")
    .selectAll()
    .where("id", "=", scheduleId)
    .executeTakeFirst()
  if (!row) return
  try {
    const template = await db
      .selectFrom("chat_templates")
      .selectAll()
      .where("id", "=", row.template_id)
      .where("user_id", "=", row.user_id)
      .executeTakeFirst()
    if (!template) throw new Error("Chat template not found")
    const document = parseChatTemplateDocument(template.document_json)
    const firedAt = new Date()
    const created = await createChatFromTemplate({
      userId: row.user_id,
      templateId: template.id,
      document,
      title: chatTitle(template.name, firedAt),
      settings: {},
      spaceId: row.space_id,
    })
    await recordFinish(row.id, "running", null, created.chat.id)
    const leaf = resolveActivePath(
      created.nodes,
      created.chat.selected_root_node_id
    ).at(-1)
    if (leaf?.role !== "user") {
      await recordFinish(row.id, "error", USER_LEAF, created.chat.id)
      return
    }
    const cadence = parseCadence(row.cadence_json)
    const response = await continueGeneration({
      userId: row.user_id,
      chatId: created.chat.id,
      parentId: leaf.id,
      timeZone: cadence.timeZone,
      requestSignal: new AbortController().signal,
      attachSelection: true,
      afterFinalize: async ({ outcome }) => {
        const status = statusForOutcome(outcome)
        await recordFinish(
          row.id,
          status,
          status === "error"
            ? outcome === "aborted"
              ? "The generation stopped."
              : "The generation failed."
            : null,
          created.chat.id
        )
      },
    })
    await response.body?.cancel()
  } catch (error) {
    await recordFinish(row.id, "error", errorText(error))
  }
}

export async function scheduleFromChat(input: {
  userId: string
  chatId: string
  name: string
  templateId?: string
  expectedRevision?: number
  spaceId?: string | null
  cadence: CadenceInput
}) {
  const saved = await saveChatTemplateFromChat({
    userId: input.userId,
    chatId: input.chatId,
    name: input.name,
    templateId: input.templateId,
    expectedRevision: input.expectedRevision,
  })
  if (input.templateId) {
    const existing = (await listSchedules(input.userId)).schedules.filter(
      (schedule) => schedule.templateId === saved.id
    )
    if (existing.length > 0) {
      const schedules = []
      for (const schedule of existing) {
        schedules.push(
          await updateSchedule({
            userId: input.userId,
            id: schedule.id,
            name: input.name,
            spaceId: input.spaceId,
            cadence: input.cadence,
          })
        )
      }
      return { templateId: saved.id, schedules }
    }
  }
  const created = await createSchedule({
    userId: input.userId,
    name: input.name,
    templateId: saved.id,
    spaceId: input.spaceId,
    cadence: input.cadence,
  })
  return { templateId: saved.id, schedules: [created] }
}

/** Start one run immediately. The cadence's next slot stays where it is. */
export async function runScheduleNow(
  userId: string,
  scheduleId: string,
  continueGeneration?: ScheduleContinuation
) {
  assertSchedulesAvailable()
  const row = await db
    .selectFrom("scheduled_generations")
    .selectAll()
    .where("id", "=", scheduleId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!row) throw new Error("Schedule not found")
  if (await liveGeneration(row.last_chat_id))
    throw new Error("A run is already in progress")
  const at = new Date()
  await db
    .updateTable("scheduled_generations")
    .set({
      last_status: "running",
      last_run_at: at.toISOString(),
      last_error: null,
      updated_at: at.toISOString(),
    })
    .where("id", "=", row.id)
    .execute()
  await fireSchedule(row.id, continueGeneration)
  return (await listSchedules(userId)).schedules.find(
    (schedule) => schedule.id === row.id
  )!
}

/** Claim at most one due schedule and start its generation. */
export async function runScheduleTick(
  at = new Date(),
  continueGeneration?: ScheduleContinuation
) {
  await migrate()
  await reconcileInterruptedSchedules()
  const due = await db
    .selectFrom("scheduled_generations")
    .selectAll()
    .where("enabled", "=", toDbBool(true))
    .where("next_run_at", "<=", at.toISOString())
    .orderBy("next_run_at")
    .execute()
  for (const row of due) {
    if (await liveGeneration(row.last_chat_id)) {
      await db
        .updateTable("scheduled_generations")
        .set({ last_status: "skipped", updated_at: now() })
        .where("id", "=", row.id)
        .where("last_status", "=", "running")
        .execute()
      continue
    }
    const claimed = await claimSchedule(row, at)
    if (!claimed) continue
    await fireSchedule(row.id, continueGeneration)
    return
  }
}
