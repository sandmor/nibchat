import type { Selectable } from "kysely"

export const MAX_ATTACHMENT_TEXT_CHARS = 10_000_000
export const MAX_FILE_ATTACHMENTS = 4
export const MAX_FILE_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_FILE_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024

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
  model_config_json: string
  /** Durable per-conversation linear/tree mode and tree camera. */
  view_state_json: string
  /** Library stack ref; null = use instance default. */
  prompt_stack_id: string | null
  created_at: string
  updated_at: string
}
export interface MessageNodesTable {
  id: string
  chat_id: string
  parent_id: string | null
  selected_child_id: string | null
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
/** One currently-owned generation per assistant node. Removed at terminal state. */
export interface GenerationRunsTable {
  id: string
  node_id: string
  chat_id: string
  started_at: string
  state: "starting" | "active" | "recovering" | "cancel_requested"
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
export interface PromptStacksTable {
  id: string
  user_id: string
  name: string
  stack_json: string
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
  base_url: string | null
  api_key: string | null
  api_key_env: string | null
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
  message_nodes: MessageNodesTable
  generation_runs: GenerationRunsTable
  attachments: AttachmentsTable
  message_attachments: MessageAttachmentsTable
  attachment_derivations: AttachmentDerivationsTable
  prompt_stacks: PromptStacksTable
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
    default_prompt_stack_id: string
    theme_mode: "system" | "light" | "dark"
    /** `{ disabled: string[] }` JSON. Empty disabled list means all tools on. */
    builtin_tools_json: string
    created_at: string
    updated_at: string
  }
}
export type ChatRow = Selectable<ChatsTable>
export type NodeRow = Selectable<MessageNodesTable>
export type PromptStackRow = Selectable<PromptStacksTable>
export type ThemeRow = Selectable<ThemesTable>
