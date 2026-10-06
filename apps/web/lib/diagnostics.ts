import "server-only"
import { randomUUID } from "node:crypto"
import pino from "pino"
import { db } from "@/lib/db"
import type {
  DiagnosticContext,
  DiagnosticEvent,
  DiagnosticKind,
  DiagnosticLevel,
  DiagnosticMetadata,
  DiagnosticServerEvent,
  DiagnosticTerminalOutcome,
} from "@/lib/diagnostic-contract"
export type {
  DiagnosticContext,
  DiagnosticLevel,
} from "@/lib/diagnostic-contract"
import {
  MAX_COLLECTION,
  MAX_HEADER_VALUE_CHARS,
  MAX_ID,
  MAX_NAME,
} from "@/lib/limits"
import {
  DEFAULT_DIAGNOSTIC_RETENTION_DAYS,
  DIAGNOSTIC_RETENTION_DAYS,
  type DiagnosticOutcome,
  type DiagnosticOperationsTable,
} from "@/lib/types"

const logger = pino(
  {
    name: "nibchat",
    level: [
      "fatal",
      "error",
      "warn",
      "info",
      "debug",
      "trace",
      "silent",
    ].includes(process.env.LOG_LEVEL ?? "")
      ? process.env.LOG_LEVEL!
      : "info",
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "*.apiKey",
        "*.authorization",
        "*.password",
        "*.token",
        "*.prompt",
        "*.responseBody",
        "*.requestBodyValues",
        "*.input",
        "*.output",
        "*.text",
        "*.content",
      ],
      censor: "[REDACTED]",
    },
  },
  process.stdout
)

const ALLOWED_METADATA = new Set([
  "requestId",
  "actionId",
  "generationId",
  "scheduleId",
  "providerId",
  "profileId",
  "model",
  "importSessionId",
  "attachmentId",
  "originalGenerationId",
  "replacementGenerationId",
  "toolCallId",
  "toolName",
  "durationMs",
  "modelDurationMs",
  "firstContentMs",
  "finishReason",
  "usage",
  "errorCode",
  "errorType",
  "httpStatus",
  "status",
  "analysisStatus",
  "reason",
  "phase",
  "count",
  "byteCount",
  "source",
  "pageCount",
  "pdfType",
  "replay",
  "updated",
  "outcome",
  "procedure",
  "procedureType",
  "result",
  "suppressedCount",
])
const IDENTITY_FIELDS = [
  "requestId",
  "actionId",
  "generationId",
  "scheduleId",
  "providerId",
  "model",
  "importSessionId",
  "attachmentId",
] as const
const PRUNE_INTERVAL_MS = 60_000
const ERROR_CODE = new RegExp(`^[A-Za-z0-9_-]{1,${MAX_NAME}}$`)
let lastPruneAt = 0
let pruning: Promise<void> | undefined

function cleanContext(value: DiagnosticContext = {}) {
  const safe: Record<string, string> = {}
  for (const key of [
    "userId",
    "chatId",
    "requestId",
    "actionId",
    "generationId",
    "scheduleId",
    "providerId",
    "model",
  ] as const) {
    const entry = value[key]
    if (typeof entry === "string" && entry.length > 0)
      safe[key] = entry.slice(0, MAX_ID)
  }
  return safe
}

function cleanMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const safe: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!ALLOWED_METADATA.has(key)) continue
    if (typeof entry === "string") safe[key] = entry.slice(0, MAX_ID)
    else if (typeof entry === "number" && Number.isFinite(entry))
      safe[key] = entry
    else if (typeof entry === "boolean" || entry === null) safe[key] = entry
    else if (key === "usage" && entry && typeof entry === "object") {
      const usage: Record<string, number> = {}
      for (const [name, amount] of Object.entries(entry))
        if (
          ["inputTokens", "outputTokens", "totalTokens"].includes(name) &&
          typeof amount === "number" &&
          Number.isFinite(amount)
        )
          usage[name] = amount
      safe.usage = usage
    }
  }
  let serialized = JSON.stringify(safe)
  while (Buffer.byteLength(serialized) > MAX_HEADER_VALUE_CHARS) {
    const last = Object.keys(safe).at(-1)
    if (!last) break
    delete safe[last]
    serialized = JSON.stringify(safe)
  }
  return safe
}

export function diagnosticErrorFields(error: unknown) {
  const candidate = error as {
    name?: unknown
    statusCode?: unknown
    code?: unknown
  } | null
  const fields: DiagnosticMetadata = {
    errorType:
      typeof candidate?.name === "string" &&
      /^[A-Za-z][A-Za-z0-9_]*Error$/.test(candidate.name)
        ? candidate.name
        : "Error",
  }
  if (typeof candidate?.statusCode === "number")
    fields.httpStatus = candidate.statusCode
  if (typeof candidate?.code === "string" && ERROR_CODE.test(candidate.code))
    fields.errorCode = candidate.code
  return fields
}

export function logDiagnostic(
  level: DiagnosticLevel | "debug",
  event: DiagnosticServerEvent,
  context: DiagnosticContext = {},
  metadata: DiagnosticMetadata = {}
) {
  logger[level]({ event, ...cleanMetadata(metadata), ...cleanContext(context) })
}

const repetitiveEvents = new Set<DiagnosticServerEvent>([
  "generation.cancel_poll_failed",
  "generation.cancel_check_failed",
  "generation.redis_heartbeat_failed",
  "generation.redis_client_error",
  "generation.reconcile_store_unavailable",
  "generation.reconcile_replay_unavailable",
  "activity.stream_snapshot_failed",
  "agent.recovery_runner_failed",
  "schedule.runner_failed",
])
const repeatedFailures = new Map<string, { at: number; suppressed: number }>()
export function logDiagnosticFailure(
  event: DiagnosticServerEvent,
  error: unknown,
  level: "warn" | "error" = "error",
  context: DiagnosticContext = {}
) {
  let suppressedCount = 0
  if (repetitiveEvents.has(event)) {
    const key = JSON.stringify([event, cleanContext(context)])
    const previous = repeatedFailures.get(key)
    if (previous && Date.now() - previous.at < PRUNE_INTERVAL_MS) {
      previous.suppressed++
      return
    }
    suppressedCount = previous?.suppressed ?? 0
    if (repeatedFailures.size >= MAX_COLLECTION)
      repeatedFailures.delete(repeatedFailures.keys().next().value!)
    repeatedFailures.set(key, { at: Date.now(), suppressed: 0 })
  }
  logDiagnostic(level, event, context, {
    ...diagnosticErrorFields(error),
    ...(suppressedCount ? { suppressedCount } : {}),
  })
}

export function procedureDiagnosticLevel(input: {
  result: string
  procedureType: string
  durationMs: number
}): DiagnosticLevel | "debug" {
  if (input.result !== "ok")
    return input.result === "INTERNAL_SERVER_ERROR" ? "error" : "warn"
  return input.procedureType === "mutation" || input.durationMs >= 1000
    ? "info"
    : "debug"
}
export function logDiagnosticProcedure(input: {
  procedure: string
  procedureType: string
  durationMs: number
  result: string
  userId?: string
  requestId?: string
}) {
  logDiagnostic(
    procedureDiagnosticLevel(input),
    "api.procedure",
    { userId: input.userId, requestId: input.requestId },
    input
  )
}

type OperationScope = {
  id: string
  kind: DiagnosticKind
  context: DiagnosticContext
  metadata: Record<string, unknown>
  startedAt: string
}
function logRecord(
  scope: OperationScope,
  event: DiagnosticEvent,
  level: DiagnosticLevel,
  fields: Record<string, unknown>
) {
  logger[level]({
    ...scope.metadata,
    ...cleanMetadata(fields),
    ...cleanContext(scope.context),
    operationId: scope.id,
    operation: scope.kind,
    event,
  })
}
function mergeFields(scope: OperationScope, fields: DiagnosticMetadata) {
  const safe = cleanMetadata(fields)
  for (const key of IDENTITY_FIELDS) if (key in scope.metadata) delete safe[key]
  return cleanMetadata({ ...scope.metadata, ...safe })
}
function eventRow(
  scope: OperationScope,
  event: DiagnosticEvent,
  level: DiagnosticLevel,
  fields: Record<string, unknown>,
  at = new Date().toISOString()
) {
  return {
    id: randomUUID(),
    operation_id: scope.id,
    user_id: scope.context.userId ?? null,
    chat_id: scope.context.chatId ?? null,
    level,
    event,
    created_at: at,
    metadata_json: JSON.stringify(fields),
  }
}
async function writeEvent(
  scope: OperationScope,
  event: DiagnosticEvent,
  level: DiagnosticLevel,
  fields: DiagnosticMetadata
) {
  const metadata = mergeFields(scope, fields)
  logRecord(scope, event, level, metadata)
  try {
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto("diagnostic_events")
        .values(eventRow(scope, event, level, metadata))
          .execute()
    })
  } catch {
    logDiagnostic("warn", "diagnostics.persistence_failed", scope.context)
  }
}
function scopeFromRow(row: DiagnosticOperationsTable): OperationScope {
  const metadata = parseMetadata(row.metadata_json)
  return {
    id: row.id,
    kind: row.kind,
    context: {
      ...cleanContext(metadata as DiagnosticContext),
      userId: row.user_id,
      chatId: row.chat_id,
    },
    metadata,
    startedAt: row.started_at,
  }
}

export async function startDiagnosticOperation(input: {
  id?: string
  kind: DiagnosticKind
  context?: DiagnosticContext
  metadata?: DiagnosticMetadata
}) {
  const scope: OperationScope = {
    id: input.id ?? randomUUID(),
    kind: input.kind,
    context: { ...input.context },
    metadata: cleanMetadata({
      ...input.metadata,
      ...cleanContext(input.context),
    }),
    startedAt: new Date().toISOString(),
  }
  delete scope.metadata.durationMs
  let started = false
  try {
    await db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto("diagnostic_operations")
        .values({
          id: scope.id,
          user_id: scope.context.userId ?? null,
          chat_id: scope.context.chatId ?? null,
          kind: scope.kind,
          outcome: "running",
          started_at: scope.startedAt,
          finished_at: null,
          duration_ms: null,
          metadata_json: JSON.stringify(scope.metadata),
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .returning("id")
        .executeTakeFirst()
      if (inserted) {
        await trx
          .insertInto("diagnostic_events")
          .values(
            eventRow(
              scope,
              "operation.started",
              "info",
              scope.metadata,
              scope.startedAt
            )
          )
          .execute()
        started = true
      } else {
        const existing = await trx
          .selectFrom("diagnostic_operations")
          .selectAll()
          .where("id", "=", scope.id)
          .executeTakeFirstOrThrow()
        Object.assign(scope, scopeFromRow(existing))
      }
    })
    if (started) logRecord(scope, "operation.started", "info", scope.metadata)
  } catch {
    logRecord(scope, "operation.started", "info", scope.metadata)
    logDiagnostic("warn", "diagnostics.persistence_failed", scope.context)
  }
  try {
    await pruneDiagnostics()
  } catch {
    logDiagnostic("warn", "diagnostics.persistence_failed", scope.context)
  }
  let finished = false
  return {
    id: scope.id,
    event: (
      event: Exclude<
        DiagnosticEvent,
        "operation.started" | "operation.finished"
      >,
      level: DiagnosticLevel = "info",
      fields: DiagnosticMetadata = {}
    ) => writeEvent(scope, event, level, fields),
    warn: (reason: string, fields: DiagnosticMetadata = {}, error?: unknown) =>
      writeEvent(scope, "operation.warning", "warn", {
        ...fields,
        ...(error === undefined ? {} : diagnosticErrorFields(error)),
        reason,
      }),
    updateContext: async (
      context: DiagnosticContext,
      fields: DiagnosticMetadata = {}
    ) => {
      // Operation identity never changes. Provider/model and associated chat can be resolved later.
      const immutable = Object.fromEntries(
        (
          [
            "userId",
            "generationId",
            "actionId",
            "scheduleId",
            "requestId",
          ] as const
        )
          .filter((key) => scope.context[key] !== undefined)
          .map((key) => [key, scope.context[key]])
      )
      scope.context = { ...scope.context, ...context, ...immutable }
      scope.metadata = cleanMetadata({
        ...mergeFields(scope, fields),
        ...cleanContext(scope.context),
      })
      try {
        await db
          .updateTable("diagnostic_operations")
          .set({
            chat_id: scope.context.chatId ?? null,
            metadata_json: JSON.stringify(scope.metadata),
          })
          .where("id", "=", scope.id)
          .where("outcome", "=", "running")
          .execute()
        await db
          .updateTable("diagnostic_events")
          .set({ chat_id: scope.context.chatId ?? null })
          .where("operation_id", "=", scope.id)
          .execute()
      } catch {
        logDiagnostic("warn", "diagnostics.persistence_failed", scope.context)
      }
    },
    finish: async (
      outcome: DiagnosticTerminalOutcome,
      fields: DiagnosticMetadata = {},
      error?: unknown
    ) => {
      if (finished) return
      finished = true
      await finishOperation(scope.id, outcome, fields, error, scope)
    },
  }
}
export type DiagnosticOperationHandle = Awaited<
  ReturnType<typeof startDiagnosticOperation>
>

export async function finishDiagnosticOperationById(
  id: string,
  outcome: DiagnosticTerminalOutcome,
  fields: DiagnosticMetadata = {},
  error?: unknown
) {
  await finishOperation(id, outcome, fields, error)
}
async function finishOperation(
  id: string,
  outcome: DiagnosticTerminalOutcome,
  fields: DiagnosticMetadata,
  error?: unknown,
  fallback?: OperationScope
) {
  const endedAt = new Date().toISOString()
  let scope = fallback
  let metadata = cleanMetadata({
    ...fields,
    ...(error === undefined ? {} : diagnosticErrorFields(error)),
    outcome,
  })
  const level: DiagnosticLevel =
    outcome === "error"
      ? "error"
      : outcome === "interrupted" ||
          (outcome === "fallback" && error !== undefined)
        ? "warn"
        : "info"
  let emitted = false
  try {
    const finished = await db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom("diagnostic_operations")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst()
      if (!row) return "missing" as const
      scope = scopeFromRow(row)
      if (row.outcome !== "running") return false
      const durationMs = Math.max(
        0,
        Date.parse(endedAt) - Date.parse(row.started_at)
      )
      const merged = mergeFields(scope, metadata)
      delete merged.outcome
      delete merged.durationMs
      metadata = cleanMetadata({ outcome, durationMs, ...merged })
      const result = await trx
        .updateTable("diagnostic_operations")
        .set({
          outcome,
          finished_at: endedAt,
          duration_ms: durationMs,
          metadata_json: JSON.stringify(metadata),
        })
        .where("id", "=", id)
        .where("outcome", "=", "running")
        .executeTakeFirst()
      if (Number(result.numUpdatedRows) !== 1) return false
      await trx
        .insertInto("diagnostic_events")
        .values(eventRow(scope, "operation.finished", level, metadata, endedAt))
        .execute()
      return true
    })
    if (finished === false) return
    if (scope) logRecord(scope, "operation.finished", level, metadata)
    else
      logger[level]({
        operationId: id,
        event: "operation.finished",
        ...metadata,
      })
    emitted = true
    await pruneDiagnostics()
  } catch {
    if (!emitted) {
      if (scope)
        logRecord(scope, "operation.finished", level, {
          ...metadata,
          durationMs: Math.max(
            0,
            Date.parse(endedAt) - Date.parse(scope.startedAt)
          ),
        })
      else
        logger[level]({
          operationId: id,
          event: "operation.finished",
          ...metadata,
        })
    }
    logDiagnostic("warn", "diagnostics.persistence_failed", scope?.context)
  }
}

export async function listDiagnosticOperations(input: {
  userId: string
  isOwner: boolean
  cursor?: string
  limit?: number
  kind?: DiagnosticKind
  outcome?: DiagnosticOutcome
  chatId?: string
  since?: string
  level?: DiagnosticLevel
}) {
  const limit = Math.min(
    Math.max(input.limit ?? MAX_COLLECTION, 1),
    MAX_COLLECTION
  )
  const cutoff = await retentionCutoff()
  let query = db
    .selectFrom("diagnostic_operations")
    .selectAll()
    .where("started_at", ">=", cutoff)
  if (!input.isOwner) query = query.where("user_id", "=", input.userId)
  else if (input.userId !== "*")
    query = query.where((eb) =>
      eb.or([eb("user_id", "=", input.userId), eb("user_id", "is", null)])
    )
  const cursor = decodeCursor(input.cursor)
  if (cursor)
    query = query.where((eb) =>
      eb.or([
        eb("started_at", "<", cursor.startedAt),
        eb.and([
          eb("started_at", "=", cursor.startedAt),
          eb("id", "<", cursor.id),
        ]),
      ])
    )
  if (input.kind) query = query.where("kind", "=", input.kind)
  if (input.outcome)
    query = query.where("outcome", "=", input.outcome as DiagnosticOutcome)
  if (input.chatId) query = query.where("chat_id", "=", input.chatId)
  if (input.since) query = query.where("started_at", ">=", input.since)
  if (input.level) {
    const level = input.level
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom("diagnostic_events")
          .select("id")
          .whereRef(
            "diagnostic_events.operation_id",
            "=",
            "diagnostic_operations.id"
          )
          .where("level", "=", level)
      )
    )
  }
  const rows = await query
    .orderBy("started_at", "desc")
    .orderBy("id", "desc")
    .limit(limit + 1)
    .execute()
  const hasMore = rows.length > limit
  const operations = rows.slice(0, limit)
  const ids = operations.map((row) => row.id)
  const events = ids.length
    ? await db
        .selectFrom("diagnostic_events")
        .selectAll()
        .where("operation_id", "in", ids)
        .orderBy("created_at", "asc")
        .execute()
    : []
  const byOperation = new Map<string, typeof events>()
  for (const event of events) {
    const current = byOperation.get(event.operation_id!) ?? []
    current.push(event)
    byOperation.set(event.operation_id!, current)
  }
  return {
    operations: operations.map((operation) => ({
      ...operation,
      metadata: parseMetadata(operation.metadata_json),
      events: (byOperation.get(operation.id) ?? []).map((event) => ({
        ...event,
        metadata: parseMetadata(event.metadata_json),
      })),
    })),
    nextCursor: hasMore
      ? encodeCursor(operations.at(-1)!.started_at, operations.at(-1)!.id)
      : null,
  }
}

function encodeCursor(startedAt: string, id: string) {
  return Buffer.from(JSON.stringify({ startedAt, id })).toString("base64url")
}

function decodeCursor(cursor?: string) {
  if (!cursor || cursor.length > MAX_ID) return null
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as { startedAt?: unknown; id?: unknown }
    if (typeof parsed.startedAt === "string" && typeof parsed.id === "string")
      return { startedAt: parsed.startedAt, id: parsed.id }
  } catch {
    // An invalid cursor starts at the first page.
  }
  return null
}

export async function getDiagnosticRetentionDays() {
  const row = await db
    .selectFrom("diagnostic_settings")
    .select("retention_days")
    .where("id", "=", 1)
    .executeTakeFirst()
  return row?.retention_days ?? DEFAULT_DIAGNOSTIC_RETENTION_DAYS
}

export async function setDiagnosticRetentionDays(retentionDays: number) {
  if (!(DIAGNOSTIC_RETENTION_DAYS as readonly number[]).includes(retentionDays))
    throw new Error("Unsupported retention period")
  await db
    .updateTable("diagnostic_settings")
    .set({ retention_days: retentionDays })
    .where("id", "=", 1)
    .execute()
  await pruneDiagnostics(true)
  return retentionDays
}

export async function clearDiagnosticHistory(userId: string, isOwner: boolean) {
  await db.transaction().execute(async (trx) => {
    if (isOwner) {
      await trx.deleteFrom("diagnostic_operations").execute()
      await trx.deleteFrom("diagnostic_events").execute()
    } else {
      await trx
        .deleteFrom("diagnostic_operations")
        .where("user_id", "=", userId)
        .execute()
      await trx
        .deleteFrom("diagnostic_events")
        .where("user_id", "=", userId)
        .execute()
    }
  })
}

export async function exportDiagnosticEvents(input: {
  userId: string
  isOwner: boolean
  chatId?: string
  kind?: DiagnosticKind
  outcome?: DiagnosticOutcome
  since?: string
  level?: DiagnosticLevel
}) {
  const cutoff = await retentionCutoff()
  let query = db
    .selectFrom("diagnostic_events")
    .leftJoin(
      "diagnostic_operations as operation",
      "operation.id",
      "diagnostic_events.operation_id"
    )
    .selectAll("diagnostic_events")
    .select("operation.kind as operation")
    .where("created_at", ">=", cutoff)
    .where((eb) =>
      eb.or([
        eb("operation_id", "is", null),
        eb.exists(
          eb
            .selectFrom("diagnostic_operations")
            .select("id")
            .whereRef(
              "diagnostic_operations.id",
              "=",
              "diagnostic_events.operation_id"
            )
            .where("started_at", ">=", cutoff)
        ),
      ])
    )
  if (!input.isOwner)
    query = query.where("diagnostic_events.user_id", "=", input.userId)
  else if (input.userId !== "*")
    query = query.where((eb) =>
      eb.or([
        eb("diagnostic_events.user_id", "=", input.userId),
        eb("diagnostic_events.user_id", "is", null),
      ])
    )
  if (input.chatId)
    query = query.where("diagnostic_events.chat_id", "=", input.chatId)
  if (input.since) query = query.where("created_at", ">=", input.since)
  if (input.level) query = query.where("level", "=", input.level)
  if (input.kind || input.outcome)
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom("diagnostic_operations")
          .select("diagnostic_operations.id")
          .whereRef(
            "diagnostic_operations.id",
            "=",
            "diagnostic_events.operation_id"
          )
          .$if(Boolean(input.kind), (operationQuery) =>
            operationQuery.where("kind", "=", input.kind!)
          )
          .$if(Boolean(input.outcome), (operationQuery) =>
            operationQuery.where("outcome", "=", input.outcome!)
          )
      )
    )
  const rows = await query.orderBy("created_at", "desc").execute()
  return rows.map((row) => ({
    ...row,
    metadata: parseMetadata(row.metadata_json),
  }))
}

async function retentionCutoff() {
  const days = await getDiagnosticRetentionDays()
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

export async function pruneDiagnostics(force = false) {
  // Reserve cleanup before the first database await so concurrent producers
  // don't all perform the same scans and cascading deletes.
  while (pruning) await pruning
  const now = Date.now()
  if (!force && now - lastPruneAt < PRUNE_INTERVAL_MS) return
  pruning = pruneDiagnosticHistory()
  try {
    await pruning
    lastPruneAt = now
  } finally {
    pruning = undefined
  }
}

async function pruneDiagnosticHistory() {
  const retentionDays = await getDiagnosticRetentionDays()
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString()
  await db
    .deleteFrom("diagnostic_operations")
    .where("started_at", "<", cutoff)
    .execute()
  await db
    .deleteFrom("diagnostic_events")
    .where("created_at", "<", cutoff)
    .where("operation_id", "is", null)
    .execute()
}

function parseMetadata(json: string) {
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}

export type DiagnosticOperation = DiagnosticOperationsTable
