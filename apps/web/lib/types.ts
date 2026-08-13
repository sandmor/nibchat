import type { Selectable } from "kysely"

export const MAX_ATTACHMENT_TEXT_CHARS = 10_000_000
export const MAX_IMAGE_ATTACHMENTS = 4
export const MAX_IMAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_IMAGE_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024

export type MessageRole = "user" | "assistant" | "system" | "tool"
export type MessageStatus =
  | "complete"
  | "streaming"
  | "stopped"
  | "error"
  | "awaiting_input"

export type TextPart = { type: "text"; text: string }
export type ReasoningPart = { type: "reasoning"; text: string }
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
  title: string
  selected_root_node_id: string | null
  model_config_json: string
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
  status: MessageStatus
  created_at: string
  updated_at: string
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
export interface PromptStacksTable {
  id: string
  name: string
  stack_json: string
  created_at: string
  updated_at: string
}
export interface InstanceTable {
  id: number
  owner_user_id: string | null
  default_prompt_stack_id: string
  appearance_json: string
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
  attachments: AttachmentsTable
  message_attachments: MessageAttachmentsTable
  prompt_stacks: PromptStacksTable
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
}
export type ChatRow = Selectable<ChatsTable>
export type NodeRow = Selectable<MessageNodesTable>
export type PromptStackRow = Selectable<PromptStacksTable>
