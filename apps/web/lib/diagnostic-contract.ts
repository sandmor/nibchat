/** Shared by server diagnostics, API validation, and Activity. No server imports. */
export const DIAGNOSTIC_KIND_LABELS = {
  "chat.title.generate": "Title",
  "chat.reply.generate": "Reply",
  "schedule.execute": "Schedule",
  "agent.recovery": "Recovery",
  "mcp.catalog.refresh": "MCP catalog refresh",
  "attachment.analysis.save": "Analysis save",
  "attachment.upload": "Upload",
  "conversation.import.publish": "Import publish",
  "backup.export": "Backup",
  "backup.restore": "Restore",
} as const
export type DiagnosticKind = keyof typeof DIAGNOSTIC_KIND_LABELS
export const DIAGNOSTIC_KINDS = Object.keys(DIAGNOSTIC_KIND_LABELS) as [
  DiagnosticKind,
  ...DiagnosticKind[],
]

export const DIAGNOSTIC_OUTCOME_LABELS = {
  running: "Running",
  complete: "Complete",
  awaiting_input: "Awaiting input",
  fallback: "Fallback",
  error: "Error",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
  skipped: "Skipped",
} as const
export type DiagnosticOutcome = keyof typeof DIAGNOSTIC_OUTCOME_LABELS
export const DIAGNOSTIC_OUTCOMES = Object.keys(DIAGNOSTIC_OUTCOME_LABELS) as [
  DiagnosticOutcome,
  ...DiagnosticOutcome[],
]
export type DiagnosticTerminalOutcome = Exclude<DiagnosticOutcome, "running">

export const DIAGNOSTIC_EVENT_LABELS = {
  "operation.started": "Started",
  "operation.finished": "Finished",
  "operation.warning": "Warning",
  "tool.started": "Tool started",
  "tool.finished": "Tool finished",
  "tool.requested": "User input requested",
} as const
export type DiagnosticEvent = keyof typeof DIAGNOSTIC_EVENT_LABELS
export const DIAGNOSTIC_EVENTS = Object.keys(DIAGNOSTIC_EVENT_LABELS) as [
  DiagnosticEvent,
  ...DiagnosticEvent[],
]
export const DIAGNOSTIC_LEVELS = ["info", "warn", "error"] as const
export type DiagnosticLevel = (typeof DIAGNOSTIC_LEVELS)[number]
export const DIAGNOSTIC_RETENTION_DAYS = [1, 7, 14, 30, 60, 90] as const
export const DEFAULT_DIAGNOSTIC_RETENTION_DAYS =
  7 satisfies (typeof DIAGNOSTIC_RETENTION_DAYS)[number]

export type DiagnosticContext = {
  userId?: string | null
  chatId?: string | null
  requestId?: string
  actionId?: string
  generationId?: string
  scheduleId?: string
  providerId?: string
  model?: string
}
export type DiagnosticMetadata = {
  requestId?: string
  actionId?: string
  generationId?: string
  scheduleId?: string
  providerId?: string
  profileId?: string
  model?: string
  importSessionId?: string
  attachmentId?: string
  originalGenerationId?: string
  replacementGenerationId?: string
  toolCallId?: string
  toolName?: string
  durationMs?: number
  modelDurationMs?: number
  firstContentMs?: number
  finishReason?: string
  usage?: unknown
  errorCode?: string
  errorType?: string
  httpStatus?: number
  status?: string
  analysisStatus?: string
  reason?: string
  phase?: string
  count?: number
  byteCount?: number
  source?: string
  pageCount?: number
  pdfType?: string
  replay?: boolean
  updated?: boolean
  outcome?: DiagnosticOutcome
  procedure?: string
  procedureType?: string
  result?: string
  suppressedCount?: number
}

export const DIAGNOSTIC_SERVER_EVENTS = [
  "api.procedure",
  "diagnostics.persistence_failed",
  "activity.request_failed",
  "activity.stream_snapshot_failed",
  "chat.title.task_error",
  "generation.setup_failed",
  "generation.action_stream_retry",
  "generation.attach_store_unavailable",
  "generation.cancel_request_failed",
  "generation.after_finalize_failed",
  "generation.cancel_check_failed",
  "generation.restore_awaiting_input_failed",
  "generation.settled_callback_failed",
  "generation.setup_finalization_failed",
  "generation.terminal_publish_failed",
  "provider.protocol_learning_failed",
  "generation.cancel_signal_failed",
  "generation.reconcile_replay_unavailable",
  "generation.reconcile_store_unavailable",
  "generation.sibling_start_failed",
  "generation.executor_failed",
  "generation.redis_client_error",
  "generation.redis_heartbeat_failed",
  "generation.cancel_poll_failed",
  "agent.recovery_runner_failed",
  "schedule.runner_failed",
  "schedule.reply_finalize_failed",
] as const
export type DiagnosticServerEvent = (typeof DIAGNOSTIC_SERVER_EVENTS)[number]
