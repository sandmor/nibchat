import type { Selectable } from "kysely"

export {
  MAX_ATTACHMENT_TEXT_CHARS,
  MAX_FILE_ATTACHMENT_BYTES,
  MAX_FILE_ATTACHMENT_TOTAL_BYTES,
  MAX_FILE_ATTACHMENTS,
} from "@/lib/limits"

export type MessageRole = "user" | "assistant" | "system" | "tool"
export type MessageStatus =
  | "complete"
  | "streaming"
  | "stopped"
  | "error"
  | "awaiting_input"

type ProviderPartMetadata = Record<string, unknown>

export type TextPart = {
  type: "text"
  text: string
  /** Live stream item identity; stripped before the part is persisted. */
  streamId?: string
  providerMetadata?: ProviderPartMetadata
}
export type ReasoningPart = {
  type: "reasoning"
  text: string
  streamId?: string
  /** Includes opaque encrypted reasoning needed for stateless replay. */
  providerMetadata?: ProviderPartMetadata
}
export type ToolInvocationState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error"
export type ToolInvocationPart = {
  type: "tool-invocation"
  toolCallId: string
  toolName: string
  state: ToolInvocationState
  input: unknown
  output?: unknown
  errorText?: string
  providerMetadata?: ProviderPartMetadata
}

/** A source selected in the composer, before the server snapshots its content. */
export type AttachmentReference =
  | {
      kind: "mcp-resource"
      profileId: string
      uri: string
      resolution: { kind: "live" } | { kind: "snapshot"; id: string }
    }
  | {
      kind: "uploaded-file"
      id: string
    }

/** Provenance for a durable attachment snapshot. */
export type AttachmentSource =
  | {
      kind: "mcp-resource"
      profileId: string
      profileName: string
      uri: string
    }
  | { kind: "upload" }

/** Resolved attachment content. Future binary variants belong in this union. */
export type AttachmentContent =
  | {
      kind: "text"
      text: string
      truncated?: {
        originalCharacters: number
      }
    }
  | {
      kind: "binary"
      attachmentId: string
      mediaType: string
      byteSize: number
      sha256: string
    }
  | {
      kind: "document"
      attachmentId: string
      mediaType: "application/pdf"
      byteSize: number
      sha256: string
      analysis:
        | {
            status: "ready"
            pdfType: "TextBased" | "Scanned" | "ImageBased" | "Mixed"
            pageCount: number
            markdown: string
          }
        | {
            status: "no-text" | "failed" | "unavailable"
            pdfType?: "TextBased" | "Scanned" | "ImageBased" | "Mixed"
            pageCount?: number
          }
    }

/**
 * User-attached context snapshotted by the server at send time.
 */
export type AttachmentPart = {
  type: "attachment"
  id: string
  name: string
  source: AttachmentSource
  content: AttachmentContent
}

export type Part =
  | TextPart
  | ReasoningPart
  | ToolInvocationPart
  | AttachmentPart
export type Parts = Part[]

export interface ChatsTable {
  id: string
  user_id: string
  /** Null means unnamed; UI shows "New conversation". */
  title: string | null
  selected_root_node_id: string | null
  /** Sparse explicit overrides. Missing keys inherit user and space defaults. */
  settings_json: string
  /** Durable per-conversation linear/tree mode and tree camera. */
  view_state_json: string
  /** Innermost space; null = ungrouped. */
  space_id: string | null
  created_at: string
  updated_at: string
}
export interface MessageNodesTable {
  id: string
  chat_id: string
  parent_id: string | null
  selected_child_id: string | null
  /** Durable sibling/root order. Structural operations may reorder without
   * falsifying message creation time. */
  sort_key: number
  /** Optimistic-concurrency revision for destructive replacement. */
  revision: number
  role: MessageRole
  parts_json: string
  search_text: string
  metadata_json: string
  /** When true, retain this node in the tree but omit it from future model context. */
  excluded_from_context: boolean
  status: MessageStatus
  created_at: string
  updated_at: string
}
export type ScheduleRunStatus =
  | "running"
  | "complete"
  | "awaiting_input"
  | "error"
  | "skipped"
export interface ScheduledJobsTable {
  id: string
  user_id: string
  name: string
  action_json: string
  cadence_json: string
  enabled: boolean
  next_run_at: string | null
  last_run_at: string | null
  last_status: ScheduleRunStatus | null
  last_error: string | null
  last_chat_id: string | null
  created_at: string
  updated_at: string
}
export interface ScheduledJobAttachmentsTable {
  schedule_id: string
  attachment_id: string
}
export interface ScheduledJobRunsTable {
  id: string
  schedule_id: string
  scheduled_for: string
  started_at: string
  finished_at: string | null
  status: ScheduleRunStatus
  error: string | null
  chat_id: string | null
  message_id: string | null
}
export interface ChatTemplatesTable {
  id: string
  user_id: string
  name: string
  document_json: string
  revision: number
  source_json: string
  created_at: string
  updated_at: string
}
export interface TemplateChatsTable {
  template_id: string
  chat_id: string
}
export interface DraftMaterializationsTable {
  user_id: string
  draft_id: string
  chat_id: string
  created_at: string
}
/** One currently-owned generation per assistant node. Removed at terminal state. */
export interface GenerationRunsTable {
  id: string
  node_id: string
  chat_id: string
  started_at: string
  state: "starting" | "active" | "recovering" | "cancel_requested"
}
/** Short-lived action receipt; the live generation_runs rows are removed at completion. */
export interface GenerationActionsTable {
  id: string
  user_id: string
  chat_id: string
  intent: string
  request_hash: string
  user_node_id: string | null
  /** Assistant row this action selected, when it rewired the linear path. */
  selected_node_id: string | null
  created_at: string
  completed_at: string | null
}
export interface GenerationActionItemsTable {
  action_id: string
  position: number
  generation_id: string
  assistant_node_id: string
  parent_node_id: string | null
}
export interface AttachmentsTable {
  id: string
  user_id: string
  filename: string
  media_type: string
  byte_size: number
  sha256: string
  storage_backend: "filesystem" | "database"
  storage_key: string | null
  data: Uint8Array | null
  claimed_at: string | null
  created_at: string
}
export interface MessageAttachmentsTable {
  message_node_id: string
  attachment_id: string
}
export interface AttachmentDerivationsTable {
  attachment_id: string
  kind: "pdf"
  data_json: string
  created_at: string
  updated_at: string
}
/** Source identities make imports safe to retry without mutating local chats. */
export interface ImportReceiptsTable {
  user_id: string
  source: string
  parser_version: number
  source_conversation_id: string
  source_fingerprint: string
  chat_id: string | null
  created_at: string
}
export interface ImportSessionsTable {
  id: string
  user_id: string
  source: string
  parser_version: number
  source_conversation_id: string
  source_fingerprint: string
  title: string | null
  space_id: string
  source_created_at: string
  source_updated_at: string
  node_count: number
  selected_root_source_id: string | null
  variables_json: string
  created_at: string
  updated_at: string
}
export interface ImportNodesTable {
  session_id: string
  position: number
  source_node_id: string
  parent_source_id: string | null
  selected_child_source_id: string | null
  role: MessageRole
  parts_json: string
  source_model: string | null
  source_api: string | null
  speaker_json: string | null
  excluded: boolean
  created_at: string
}
export interface ImportAssetsTable {
  session_id: string
  source_asset_id: string
  filename: string
  media_type: string
  byte_size: number
  sha256: string | null
  attachment_id: string | null
  state: "uploading" | "ready" | "omitted"
  reason: string | null
  data: Uint8Array | null
}
export interface ImportSpaceMappingsTable {
  user_id: string
  source: string
  entity_id: string
  space_id: string
  created_at: string
}
export interface ImportBookMappingsTable {
  user_id: string
  source: string
  entity_id: string
  context_book_id: string
  source_fingerprint: string
  created_at: string
}
export interface PromptStacksTable {
  id: string
  user_id: string
  name: string
  stack_json: string
  created_at: string
  updated_at: string
}
export interface ContextBooksTable {
  id: string
  user_id: string
  name: string
  book_json: string
  created_at: string
  updated_at: string
}
export interface ChatContextBooksTable {
  chat_id: string
  context_book_id: string
  position: number
}
export interface SpacesTable {
  id: string
  user_id: string
  parent_id: string | null
  sort_key: number
  name: string
  description: string
  metadata_json: string
  settings_json: string
  created_at: string
  updated_at: string
}
export interface ThemesTable {
  id: string
  user_id: string
  name: string
  document_json: string
  created_at: string
  updated_at: string
}
export interface InstanceTable {
  id: number
  owner_user_id: string | null
  /** `{ providerId, model }` JSON; null means title LLM is off. */
  title_model_config_json: string | null
  /** ISO timestamp; null means first-run setup is still in progress. */
  onboarding_completed_at: string | null
  created_at: string
}
export interface ProviderProfilesTable {
  id: string
  user_id: string
  name: string
  kind: string
  config_json: string
  models_json: string
  created_at: string
  updated_at: string
}
export interface ModelCatalogCacheTable {
  provider_id: string
  models_json: string
  refreshed_at: string
}
export interface McpServerProfilesTable {
  id: string
  user_id: string
  name: string
  namespace: string
  enabled: boolean
  transport: string
  protocol_mode: string
  config_json: string
  catalog_json: string
  tool_allowlist_json: string
  created_at: string
  updated_at: string
}
export interface DB {
  chats: ChatsTable
  chat_templates: ChatTemplatesTable
  template_chats: TemplateChatsTable
  scheduled_jobs: ScheduledJobsTable
  scheduled_job_attachments: ScheduledJobAttachmentsTable
  scheduled_job_runs: ScheduledJobRunsTable
  draft_materializations: DraftMaterializationsTable
  spaces: SpacesTable
  message_nodes: MessageNodesTable
  generation_runs: GenerationRunsTable
  generation_actions: GenerationActionsTable
  generation_action_items: GenerationActionItemsTable
  attachments: AttachmentsTable
  message_attachments: MessageAttachmentsTable
  attachment_derivations: AttachmentDerivationsTable
  import_receipts: ImportReceiptsTable
  import_sessions: ImportSessionsTable
  import_nodes: ImportNodesTable
  import_assets: ImportAssetsTable
  import_space_mappings: ImportSpaceMappingsTable
  import_book_mappings: ImportBookMappingsTable
  prompt_stacks: PromptStacksTable
  context_books: ContextBooksTable
  chat_context_books: ChatContextBooksTable
  themes: ThemesTable
  instance: InstanceTable
  provider_profiles: ProviderProfilesTable
  model_catalog_cache: ModelCatalogCacheTable
  mcp_server_profiles: McpServerProfilesTable
  user: {
    id: string
    name: string
    email: string
    emailVerified: boolean
    image: string | null
    createdAt: string
    updatedAt: string
    role: string | null
    banned: boolean | null
    banReason: string | null
    banExpires: string | null
  }
  session: {
    id: string
    expiresAt: string
    token: string
    createdAt: string
    updatedAt: string
    ipAddress: string | null
    userAgent: string | null
    userId: string
    impersonatedBy: string | null
  }
  account: {
    id: string
    accountId: string
    providerId: string
    userId: string
    accessToken: string | null
    refreshToken: string | null
    idToken: string | null
    accessTokenExpiresAt: string | null
    refreshTokenExpiresAt: string | null
    scope: string | null
    password: string | null
    createdAt: string
    updatedAt: string
  }
  verification: {
    id: string
    identifier: string
    value: string
    expiresAt: string
    createdAt: string
    updatedAt: string
  }
  user_preferences: {
    user_id: string
    light_theme_id: string
    dark_theme_id: string
    theme_mode: "system" | "light" | "dark"
    /** `{ disabled: string[] }` JSON. Empty disabled list means all tools on. */
    builtin_tools_json: string
    pdf_image_page_limit: number | string
    chat_defaults_json: string
    created_at: string
    updated_at: string
  }
}
export type ChatRow = Selectable<ChatsTable>
/** A pending reply scheduled from this node. Absent on rows that did not come from the workspace. */
export type NodeSchedule = {
  id: string
  nextRunAt: string
  timeZone: string
  replyCount?: number
}
export type NodeRow = Selectable<MessageNodesTable> & {
  schedules?: NodeSchedule[]
}
export type ChatTemplateRow = Selectable<ChatTemplatesTable>
export type PromptStackRow = Selectable<PromptStacksTable>
export type SpaceRow = Selectable<SpacesTable>
export type ThemeRow = Selectable<ThemesTable>
