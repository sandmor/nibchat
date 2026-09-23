import "server-only"
import type { Transaction } from "kysely"
import { z } from "zod"
import type { GenerationSetup } from "@/lib/agent/run-generation"
import { continueChatGeneration } from "@/lib/agent/open-generation"
import {
  createMessage,
  prepareAuthoredParts,
  reconcileChatGenerationRuns,
  resolveSettingsForChat,
  selectPathInTransaction,
} from "@/lib/chat-service"
import {
  createChatFromTemplate,
  saveChatTemplateFromChat,
  saveChatTemplateDocument,
} from "@/lib/chat-template-service"
import {
  parseChatTemplateDocument,
  templateActiveLeaf,
  type ChatTemplateDocument,
} from "@/lib/chat-template"
import { db, fromDbBool, migrate, toDbBool } from "@/lib/db"
import {
  parseSettingValues,
  resolveSettings,
  type SettingValues,
} from "@/lib/chat-settings"
import { spaceFromRow } from "@/lib/spaces"
import { id, now, resolveActivePath } from "@/lib/domain"
import { MAX_DESCRIPTION, MAX_NAME } from "@/lib/limits"
import type {
  AttachmentReference,
  DB,
  NodeRow,
  Parts,
  ScheduleRunStatus,
  ScheduledJobsTable,
} from "@/lib/types"
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
const USER_PARENT = "A generation can only be scheduled from a user message."
const STATELESS = "Scheduled generations run only on a stateful server."
const INTERRUPTED = "The scheduled generation was interrupted."

const templateActionSchema = z.object({
  kind: z.literal("template"),
  templateId: z.string(),
  spaceId: z.string().nullable(),
  chatOverridesJson: z.string().optional(),
})
const chatGenerateActionSchema = z.object({
  kind: z.literal("chat_generate"),
  chatId: z.string(),
  parentId: z.string().nullable(),
  settingsJson: z.string(),
})
export const scheduleActionSchema = z.discriminatedUnion("kind", [
  templateActionSchema,
  chatGenerateActionSchema,
])
export type ScheduleAction = z.infer<typeof scheduleActionSchema>

export function schedulesAvailable() {
  return process.env.GENERATION_RUNTIME_MODE !== "stateless"
}
function assertSchedulesAvailable() {
  if (!schedulesAvailable()) throw new Error(STATELESS)
}
function parseAction(value: string) {
  return scheduleActionSchema.parse(JSON.parse(value))
}
function assertUserLeaf(
  document: ReturnType<typeof parseChatTemplateDocument>
) {
  if (templateActiveLeaf(document)?.role !== "user") throw new Error(USER_LEAF)
}
function errorText(error: unknown) {
  return (
    error instanceof Error && error.message
      ? error.message
      : "The scheduled generation failed."
  ).slice(0, MAX_DESCRIPTION)
}
function statusForOutcome(
  outcome: "complete" | "awaiting_input" | "aborted" | "error"
): ScheduleRunStatus {
  if (outcome === "complete") return "complete"
  if (outcome === "awaiting_input") return "awaiting_input"
  return "error"
}
function nextAfter(cadence: Cadence, at: Date) {
  return cadence.kind === "once"
    ? null
    : followingRunAt(cadence, at).toISOString()
}
function isOnceCadence(cadenceJson: string) {
  try {
    return parseCadence(cadenceJson).kind === "once"
  } catch {
    return false
  }
}

export type ScheduleView = {
  id: string
  name: string
  action: ScheduleAction
  templateId: string | null
  templateName: string | null
  spaceId: string | null
  cadence: Cadence
  enabled: boolean
  nextRunAt: string | null
  lastRunAt: string | null
  lastStatus: ScheduleRunStatus | null
  lastError: string | null
  lastChatId: string | null
}
async function toView(row: ScheduledJobsTable): Promise<ScheduleView> {
  const action = parseAction(row.action_json)
  let templateName: string | null = null
  if (action.kind === "template")
    templateName =
      (
        await db
          .selectFrom("chat_templates")
          .select("name")
          .where("id", "=", action.templateId)
          .executeTakeFirst()
      )?.name ?? "Deleted template"
  return {
    id: row.id,
    name: row.name,
    action,
    templateId: action.kind === "template" ? action.templateId : null,
    templateName,
    spaceId: action.kind === "template" ? action.spaceId : null,
    cadence: parseCadence(row.cadence_json),
    enabled: fromDbBool(row.enabled),
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    lastChatId: row.last_chat_id,
  }
}
export type PendingChatGeneration = {
  id: string
  parentId: string
  nextRunAt: string
  timeZone: string
}

/** Pending generations for one chat, included with the workspace payload. */
export async function pendingGenerationsForChat(
  userId: string,
  chatId: string
): Promise<PendingChatGeneration[]> {
  const rows = await db
    .selectFrom("scheduled_jobs")
    .selectAll()
    .where("user_id", "=", userId)
    .execute()
  const pending: PendingChatGeneration[] = []
  for (const row of rows) {
    if (!fromDbBool(row.enabled) || !row.next_run_at) continue
    let action: ScheduleAction
    try {
      action = parseAction(row.action_json)
    } catch {
      continue
    }
    if (
      action.kind !== "chat_generate" ||
      action.chatId !== chatId ||
      !action.parentId
    )
      continue
    pending.push({
      id: row.id,
      parentId: action.parentId,
      nextRunAt: row.next_run_at,
      timeZone: parseCadence(row.cadence_json).timeZone,
    })
  }
  return pending
}

export async function listSchedules(userId: string) {
  const rows = await db
    .selectFrom("scheduled_jobs")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("created_at")
    .execute()
  return {
    available: schedulesAvailable(),
    schedules: await Promise.all(rows.map(toView)),
  }
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
  if (
    !(await db
      .selectFrom("spaces")
      .select("id")
      .where("id", "=", spaceId)
      .where("user_id", "=", userId)
      .executeTakeFirst())
  )
    throw new Error("Space not found")
}
type ScheduleExecutor = typeof db | Transaction<DB>

async function insertScheduleRow(
  executor: ScheduleExecutor,
  input: {
    userId: string
    name: string
    action: ScheduleAction
    cadence: Cadence
    created: Date
  }
) {
  assertSchedulesAvailable()
  const name = input.name.trim()
  if (!name || name.length > MAX_NAME) throw new Error("Name is required")
  const timestamp = input.created.toISOString()
  const scheduleId = id()
  await executor
    .insertInto("scheduled_jobs")
    .values({
      id: scheduleId,
      user_id: input.userId,
      name,
      action_json: JSON.stringify(input.action),
      cadence_json: cadenceToJson(input.cadence),
      enabled: toDbBool(true),
      next_run_at: followingRunAt(input.cadence, input.created).toISOString(),
      last_run_at: null,
      last_status: null,
      last_error: null,
      last_chat_id: null,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute()
  return scheduleId
}

async function insertSchedule(input: {
  userId: string
  name: string
  action: ScheduleAction
  cadence: CadenceInput
}) {
  const created = new Date()
  const cadence = storeCadence(cadenceInputSchema.parse(input.cadence), created)
  const scheduleId = await insertScheduleRow(db, {
    userId: input.userId,
    name: input.name,
    action: input.action,
    cadence,
    created,
  })
  return (await listSchedules(input.userId)).schedules.find(
    (item) => item.id === scheduleId
  )!
}

/**
 * Insert a user message and the once-generation that replies to it.
 * A rejected time inserts neither. Called by the createMessage procedure.
 */
export async function createScheduledUserMessage(input: {
  userId: string
  chatId: string
  parentId: string | null
  beforeNodeId?: string
  parts: Parts
  attachments?: AttachmentReference[]
  attachSelection?: boolean
  name: string
  at: string
  timeZone: string
}): Promise<NodeRow> {
  assertSchedulesAvailable()
  const name = input.name.trim()
  if (!name || name.length > MAX_NAME) throw new Error("Name is required")
  const created = new Date()
  const cadence = storeCadence(
    { kind: "once", at: input.at, timeZone: input.timeZone },
    created
  )
  followingRunAt(cadence, created)
  const chat = await db
    .selectFrom("chats")
    .selectAll()
    .where("id", "=", input.chatId)
    .where("user_id", "=", input.userId)
    .executeTakeFirst()
  if (!chat) throw new Error("Chat not found")
  const settings = await resolveSettingsForChat(chat, input.userId)
  return db.transaction().execute(async (trx) => {
    const message = await createMessage({
      userId: input.userId,
      chatId: input.chatId,
      parentId: input.parentId,
      beforeNodeId: input.beforeNodeId,
      role: "user",
      parts: input.parts,
      attachments: input.attachments,
      attachSelection: input.attachSelection,
      trx,
    })
    await insertScheduleRow(trx, {
      userId: input.userId,
      name,
      action: {
        kind: "chat_generate",
        chatId: chat.id,
        parentId: message.id,
        settingsJson: JSON.stringify(settings.effective.values),
      },
      cadence,
      created,
    })
    return message
  })
}
export async function createSchedule(input: {
  userId: string
  name: string
  templateId: string
  spaceId?: string | null
  cadence: CadenceInput
  chatOverrides?: SettingValues
}) {
  const template = await ownedTemplate(input.userId, input.templateId)
  assertUserLeaf(parseChatTemplateDocument(template.document_json))
  const spaceId = input.spaceId ?? null
  await assertSpaceOwner(input.userId, spaceId)
  return insertSchedule({
    userId: input.userId,
    name: input.name,
    action: {
      kind: "template",
      templateId: template.id,
      spaceId,
      ...(input.chatOverrides
        ? { chatOverridesJson: JSON.stringify(input.chatOverrides) }
        : {}),
    },
    cadence: input.cadence,
  })
}
export async function createChatSchedule(input: {
  userId: string
  name: string
  chatId: string
  parentId: string
  timeZone: string
  at: string
}) {
  const chat = await db
    .selectFrom("chats")
    .selectAll()
    .where("id", "=", input.chatId)
    .where("user_id", "=", input.userId)
    .executeTakeFirst()
  if (!chat) throw new Error("Chat not found")
  const parent = await db
    .selectFrom("message_nodes")
    .select(["id", "role"])
    .where("id", "=", input.parentId)
    .where("chat_id", "=", chat.id)
    .executeTakeFirst()
  if (!parent) throw new Error("Parent node not found in chat")
  if (parent.role !== "user") throw new Error(USER_PARENT)
  const settings = await resolveSettingsForChat(chat, input.userId)
  const cadence = {
    kind: "once" as const,
    at: input.at,
    timeZone: input.timeZone,
  }
  return insertSchedule({
    userId: input.userId,
    name: input.name,
    action: {
      kind: "chat_generate",
      chatId: chat.id,
      parentId: parent.id,
      settingsJson: JSON.stringify(settings.effective.values),
    },
    cadence,
  })
}

export async function updateSchedule(input: {
  userId: string
  id: string
  name?: string
  spaceId?: string | null
  cadence?: CadenceInput
  enabled?: boolean
  chatOverrides?: SettingValues
}) {
  const row = await db
    .selectFrom("scheduled_jobs")
    .selectAll()
    .where("id", "=", input.id)
    .where("user_id", "=", input.userId)
    .executeTakeFirst()
  if (!row) throw new Error("Schedule not found")
  if (input.enabled === true) assertSchedulesAvailable()
  const action = parseAction(row.action_json)
  if (action.kind === "template" && input.chatOverrides)
    action.chatOverridesJson = JSON.stringify(input.chatOverrides)
  if (input.spaceId !== undefined && action.kind === "template") {
    await assertSpaceOwner(input.userId, input.spaceId)
    action.spaceId = input.spaceId
  }
  const name = input.name?.trim() ?? row.name
  if (!name || name.length > MAX_NAME) throw new Error("Name is required")
  let cadence = parseCadence(row.cadence_json)
  if (input.cadence) cadence = storeCadence(input.cadence, new Date())
  if (action.kind !== "template" && cadence.kind !== "once")
    throw new Error("Chat actions can only run once")
  const cadenceChanged = cadenceToJson(cadence) !== row.cadence_json
  await db
    .updateTable("scheduled_jobs")
    .set({
      name,
      action_json: JSON.stringify(action),
      cadence_json: cadenceToJson(cadence),
      enabled: toDbBool(input.enabled ?? fromDbBool(row.enabled)),
      ...(cadenceChanged
        ? {
            next_run_at: followingRunAt(cadence, new Date()).toISOString(),
            last_status: null,
            last_error: null,
          }
        : {}),
      updated_at: now(),
    })
    .where("id", "=", row.id)
    .execute()
  return (await listSchedules(input.userId)).schedules.find(
    (item) => item.id === row.id
  )!
}
export async function deleteSchedule(userId: string, scheduleId: string) {
  const result = await db
    .deleteFrom("scheduled_jobs")
    .where("id", "=", scheduleId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (Number(result.numDeletedRows ?? 0) === 0)
    throw new Error("Schedule not found")
  return { ok: true as const }
}

export async function deleteChatSchedulesFor(input: {
  userId: string
  nodeIds?: readonly string[]
  chatIds?: readonly string[]
  trx?: Transaction<DB>
}) {
  const nodeIds = new Set(input.nodeIds ?? [])
  const chatIds = new Set(input.chatIds ?? [])
  if (!nodeIds.size && !chatIds.size) return
  const executor = input.trx ?? db
  const rows = await executor
    .selectFrom("scheduled_jobs")
    .select(["id", "action_json"])
    .where("user_id", "=", input.userId)
    .execute()
  const drop: string[] = []
  for (const row of rows) {
    let action: ScheduleAction
    try {
      action = parseAction(row.action_json)
    } catch {
      continue
    }
    if (action.kind === "template") continue
    if (
      chatIds.has(action.chatId) ||
      (action.parentId != null && nodeIds.has(action.parentId))
    )
      drop.push(row.id)
  }
  if (!drop.length) return
  await executor
    .deleteFrom("scheduled_jobs")
    .where("user_id", "=", input.userId)
    .where("id", "in", drop)
    .execute()
}
export async function deleteTemplateSchedulesFor(input: {
  userId: string
  templateId: string
  trx: Transaction<DB>
}) {
  const rows = await input.trx
    .selectFrom("scheduled_jobs")
    .select(["id", "action_json"])
    .where("user_id", "=", input.userId)
    .execute()
  const ids = rows.flatMap((row) => {
    try {
      const action = parseAction(row.action_json)
      return action.kind === "template" &&
        action.templateId === input.templateId
        ? [row.id]
        : []
    } catch {
      return []
    }
  })
  if (ids.length)
    await input.trx
      .deleteFrom("scheduled_jobs")
      .where("user_id", "=", input.userId)
      .where("id", "in", ids)
      .execute()
}
async function liveGeneration(chatId: string | null) {
  if (!chatId) return false
  await reconcileChatGenerationRuns(chatId)
  return Boolean(
    await db
      .selectFrom("generation_runs")
      .select("id")
      .where("chat_id", "=", chatId)
      .executeTakeFirst()
  )
}
export async function reconcileInterruptedSchedules() {
  const rows = await db
    .selectFrom("scheduled_job_runs")
    .selectAll()
    .where("status", "=", "running")
    .execute()
  for (const row of rows) {
    if (row.chat_id) await reconcileChatGenerationRuns(row.chat_id)
    const ownGeneration = row.message_id
      ? await db
          .selectFrom("generation_runs")
          .select("id")
          .where("node_id", "=", row.message_id)
          .executeTakeFirst()
      : null
    if (ownGeneration) continue
    // Claimed before the assistant row exists. Leave it while that chat is
    // still generating.
    if (!row.message_id && (await liveGeneration(row.chat_id))) continue
    await recordFinish(row.id, "error", INTERRUPTED)
  }
}
export async function claimSchedule(
  row: Pick<ScheduledJobsTable, "id" | "cadence_json" | "next_run_at">,
  at = new Date()
) {
  if (!row.next_run_at) return false
  const cadence = parseCadence(row.cadence_json)
  return db.transaction().execute(async (trx) => {
    const result = await trx
      .updateTable("scheduled_jobs")
      .set({
        next_run_at: nextAfter(cadence, at),
        enabled: toDbBool(cadence.kind !== "once"),
        last_status: "running",
        last_run_at: at.toISOString(),
        last_error: null,
        updated_at: at.toISOString(),
      })
      .where("id", "=", row.id)
      .where("enabled", "=", toDbBool(true))
      .where("next_run_at", "=", row.next_run_at)
      .executeTakeFirst()
    if (Number(result.numUpdatedRows ?? 0) !== 1) return false
    await trx
      .insertInto("scheduled_job_runs")
      .values({
        id: id(),
        schedule_id: row.id,
        scheduled_for: row.next_run_at!,
        started_at: at.toISOString(),
        finished_at: null,
        status: "running",
        error: null,
        chat_id: null,
        message_id: null,
      })
      .execute()
    return true
  })
}
async function recordFinish(
  runId: string,
  status: ScheduleRunStatus,
  error: string | null,
  chatId?: string,
  messageId?: string
) {
  const finishedAt = now()
  await db.transaction().execute(async (trx) => {
    const run = await trx
      .selectFrom("scheduled_job_runs")
      .selectAll()
      .where("id", "=", runId)
      .executeTakeFirst()
    if (!run || run.status !== "running") return
    const job = await trx
      .selectFrom("scheduled_jobs")
      .select("cadence_json")
      .where("id", "=", run.schedule_id)
      .executeTakeFirst()
    if (!job) return
    await trx
      .updateTable("scheduled_job_runs")
      .set({
        status,
        error,
        finished_at: status === "running" ? null : finishedAt,
        ...(chatId ? { chat_id: chatId } : {}),
        ...(messageId ? { message_id: messageId } : {}),
      })
      .where("id", "=", runId)
      .where("status", "=", "running")
      .execute()
    const active = await trx
      .selectFrom("scheduled_job_runs")
      .select("id")
      .where("schedule_id", "=", run.schedule_id)
      .where("status", "=", "running")
      .executeTakeFirst()
    if (status !== "running" && !active && isOnceCadence(job.cadence_json)) {
      const completed = await trx
        .selectFrom("scheduled_job_runs")
        .select("id")
        .where("schedule_id", "=", run.schedule_id)
        .where("status", "=", "complete")
        .executeTakeFirst()
      if (completed) {
        await trx
          .deleteFrom("scheduled_jobs")
          .where("id", "=", run.schedule_id)
          .execute()
        return
      }
    }
    const latest = await trx
      .selectFrom("scheduled_job_runs")
      .select("id")
      .where("schedule_id", "=", run.schedule_id)
      .orderBy("started_at", "desc")
      .orderBy("id", "desc")
      .executeTakeFirst()
    if (latest?.id === runId)
      await trx
        .updateTable("scheduled_jobs")
        .set({
          last_status: status,
          last_error: error,
          ...(chatId ? { last_chat_id: chatId } : {}),
          updated_at: finishedAt,
        })
        .where("id", "=", run.schedule_id)
        .execute()
  })
}

export type ScheduleContinuation = (input: {
  userId: string
  chatId: string
  parentId: string | null
  timeZone: string
  requestSignal: AbortSignal
  attachSelection: boolean
  settingsJson?: string
  afterFinalize?: GenerationSetup["afterFinalize"]
  onStarted?: (assistantId: string) => Promise<void>
}) => Promise<Response>
const defaultContinuation: ScheduleContinuation = (input) =>
  continueChatGeneration(input)

export async function fireSchedule(
  scheduleId: string,
  runId: string,
  continuation: ScheduleContinuation = defaultContinuation
) {
  const row = await db
    .selectFrom("scheduled_jobs")
    .selectAll()
    .where("id", "=", scheduleId)
    .executeTakeFirst()
  if (!row) return
  try {
    const action = parseAction(row.action_json)
    const cadence = parseCadence(row.cadence_json)
    let chatId: string
    let parentId: string | null
    let settingsJson: string | undefined
    if (action.kind === "template") {
      const template = await ownedTemplate(row.user_id, action.templateId)
      const document = parseChatTemplateDocument(template.document_json)
      const created = await createChatFromTemplate({
        userId: row.user_id,
        templateId: template.id,
        document,
        settings: parseSettingValues(action.chatOverridesJson),
        spaceId: action.spaceId,
      })
      const leaf = resolveActivePath(
        created.nodes,
        created.chat.selected_root_node_id
      ).at(-1)
      if (!leaf || leaf.role !== "user") throw new Error(USER_LEAF)
      chatId = created.chat.id
      parentId = leaf.id
    } else if (action.kind === "chat_generate" && action.parentId) {
      chatId = action.chatId
      parentId = action.parentId
      settingsJson = action.settingsJson
    } else {
      throw new Error(USER_PARENT)
    }
    await recordFinish(runId, "running", null, chatId)
    const response = await continuation({
      userId: row.user_id,
      chatId,
      parentId,
      timeZone: cadence.timeZone,
      requestSignal: new AbortController().signal,
      attachSelection: false,
      settingsJson,
      onStarted: async (assistantId) => {
        await db
          .updateTable("scheduled_job_runs")
          .set({ message_id: assistantId })
          .where("id", "=", runId)
          .where("status", "=", "running")
          .execute()
      },
      afterFinalize: async ({ outcome }) => {
        const status = statusForOutcome(outcome)
        await recordFinish(
          runId,
          status,
          status === "error" ? "The generation failed." : null,
          chatId
        )
      },
    })
    await response.body?.cancel()
  } catch (error) {
    await recordFinish(runId, "error", errorText(error))
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
  const saved = await saveChatTemplateFromChat(input)
  const chat = await db
    .selectFrom("chats")
    .selectAll()
    .where("id", "=", input.chatId)
    .where("user_id", "=", input.userId)
    .executeTakeFirstOrThrow()
  const chatOverrides = parseSettingValues(chat.settings_json)
  if (input.templateId) {
    const existing = (await listSchedules(input.userId)).schedules.filter(
      (item) => item.templateId === saved.id
    )
    if (existing.length)
      return {
        templateId: saved.id,
        schedules: await Promise.all(
          existing.map((item) =>
            updateSchedule({
              userId: input.userId,
              id: item.id,
              name: input.name,
              spaceId: input.spaceId,
              cadence: input.cadence,
              chatOverrides,
            })
          )
        ),
      }
  }
  return {
    templateId: saved.id,
    schedules: [
      await createSchedule({
        userId: input.userId,
        name: input.name,
        templateId: saved.id,
        spaceId: input.spaceId,
        cadence: input.cadence,
        chatOverrides,
      }),
    ],
  }
}

/** Save a new user turn as the selected template leaf and schedule fresh chats. */
export async function sendAndScheduleTemplate(input: {
  userId: string
  source:
    | { kind: "chat"; chatId: string; parentId: string | null }
    | {
        kind: "draft"
        document: ChatTemplateDocument
        parentId: string | null
        chatOverrides: SettingValues
      }
  parts: Parts
  attachments?: AttachmentReference[]
  name: string
  spaceId?: string | null
  cadence: CadenceInput
}) {
  assertSchedulesAvailable()
  const created = new Date()
  const cadence = storeCadence(cadenceInputSchema.parse(input.cadence), created)
  followingRunAt(cadence, created)
  await assertSpaceOwner(input.userId, input.spaceId ?? null)
  if (input.spaceId) {
    const spaces = await db
      .selectFrom("spaces")
      .selectAll()
      .where("user_id", "=", input.userId)
      .execute()
    const settings = resolveSettings({
      chat: {},
      spaceId: input.spaceId,
      spaces: spaces.map(spaceFromRow),
    })
    if (settings.locks.chatTemplate)
      throw new Error("Choose a space without a locked chat template")
  }
  const source = input.source
  const sourceChat =
    source.kind === "chat"
      ? await db
          .selectFrom("chats")
          .selectAll()
          .where("id", "=", source.chatId)
          .where("user_id", "=", input.userId)
          .executeTakeFirst()
      : null
  if (source.kind === "chat" && !sourceChat)
    throw new Error("Chat not found")
  const expandMessageMacros = sourceChat
    ? (await resolveSettingsForChat(sourceChat, input.userId)).effective.model
        .expandMessageMacros
    : undefined
  const preparedParts = await prepareAuthoredParts({
    userId: input.userId,
    role: "user",
    parts: input.parts,
    attachments: input.attachments,
  })
  return db.transaction().execute(async (trx) => {
    let templateId: string
    let messageId: string | null = null
    let chatOverrides: SettingValues
    if (source.kind === "chat") {
      if (!sourceChat) throw new Error("Chat not found")
      const message = await createMessage({
        userId: input.userId,
        chatId: source.chatId,
        parentId: source.parentId,
        role: "user",
        parts: input.parts,
        preparedParts,
        attachments: input.attachments,
        trx,
      })
      await selectPathInTransaction(
        trx,
        input.userId,
        source.chatId,
        message.id
      )
      const template = await saveChatTemplateFromChat({
        userId: input.userId,
        chatId: source.chatId,
        name: input.name,
        expandMessageMacros,
        trx,
      })
      templateId = template.id
      messageId = message.id
      chatOverrides = parseSettingValues(sourceChat.settings_json)
    } else {
      const document = parseChatTemplateDocument(source.document)
      const nodeId = id()
      const siblingKeys = document.nodes
        .filter((node) => node.parentId === source.parentId)
        .map((node) => node.sortKey)
      const sortKey = siblingKeys.length ? Math.max(...siblingKeys) + 1 : 0
      const nodes = document.nodes.map((node) => ({ ...node }))
      const byId = new Map(nodes.map((node) => [node.id, node]))
      if (source.parentId && !byId.has(source.parentId))
        throw new Error("Parent node not found in draft")
      nodes.push({
        id: nodeId,
        parentId: source.parentId,
        selectedChildId: null,
        sortKey,
        role: "user",
        parts: preparedParts,
        excludedFromContext: false,
      })
      let childId = nodeId
      let parentId = source.parentId
      while (parentId) {
        const parent = byId.get(parentId)
        if (!parent) throw new Error("Parent node not found in draft")
        parent.selectedChildId = childId
        childId = parent.id
        parentId = parent.parentId
      }
      const selected = parseChatTemplateDocument({
        ...document,
        selectedRootId: childId,
        nodes,
      })
      const template = await saveChatTemplateDocument({
        userId: input.userId,
        name: input.name,
        document: selected,
        trx,
      })
      templateId = template.id
      chatOverrides = source.chatOverrides
    }
    const scheduleId = await insertScheduleRow(trx, {
      userId: input.userId,
      name: input.name,
      action: {
        kind: "template",
        templateId,
        spaceId: input.spaceId ?? null,
        chatOverridesJson: JSON.stringify(chatOverrides),
      },
      cadence,
      created,
    })
    return { templateId, scheduleId, messageId }
  })
}
export async function runScheduleNow(
  userId: string,
  scheduleId: string,
  continuation?: ScheduleContinuation
) {
  assertSchedulesAvailable()
  const row = await db
    .selectFrom("scheduled_jobs")
    .selectAll()
    .where("id", "=", scheduleId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!row) throw new Error("Schedule not found")
  const cadence = parseCadence(row.cadence_json)
  const runId = id()
  await db.transaction().execute(async (trx) => {
    const previous = await trx
      .selectFrom("scheduled_job_runs")
      .select("scheduled_for")
      .where("schedule_id", "=", row.id)
      .orderBy("scheduled_for", "desc")
      .executeTakeFirst()
    const current = Date.now()
    const previousAt = previous ? Date.parse(previous.scheduled_for) : 0
    const timestamp = new Date(Math.max(current, previousAt + 1)).toISOString()
    await trx
      .updateTable("scheduled_jobs")
      .set({
        ...(cadence.kind === "once"
          ? { enabled: toDbBool(false), next_run_at: null }
          : {}),
        last_status: "running",
        last_run_at: timestamp,
        last_error: null,
        updated_at: timestamp,
      })
      .where("id", "=", row.id)
      .execute()
    await trx
      .insertInto("scheduled_job_runs")
      .values({
        id: runId,
        schedule_id: row.id,
        scheduled_for: timestamp,
        started_at: timestamp,
        finished_at: null,
        status: "running",
        error: null,
        chat_id: null,
        message_id: null,
      })
      .execute()
  })
  await fireSchedule(row.id, runId, continuation)
  return (
    (await listSchedules(userId)).schedules.find(
      (item) => item.id === row.id
    ) ?? null
  )
}
export async function runScheduleTick(
  at = new Date(),
  continuation?: ScheduleContinuation
) {
  await migrate()
  await reconcileInterruptedSchedules()
  const due = await db
    .selectFrom("scheduled_jobs")
    .selectAll()
    .where("enabled", "=", toDbBool(true))
    .where("next_run_at", "is not", null)
    .where("next_run_at", "<=", at.toISOString())
    .orderBy("next_run_at")
    .execute()
  for (const row of due) {
    if (!(await claimSchedule(row, at))) continue
    const run = await db
      .selectFrom("scheduled_job_runs")
      .select("id")
      .where("schedule_id", "=", row.id)
      .where("scheduled_for", "=", row.next_run_at!)
      .executeTakeFirstOrThrow()
    await fireSchedule(row.id, run.id, continuation)
    return
  }
}
