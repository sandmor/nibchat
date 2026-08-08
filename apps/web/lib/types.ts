import type { Selectable } from "kysely"

export type MessageRole = "user" | "assistant" | "system" | "tool"
export type MessageStatus = "complete" | "streaming" | "stopped" | "error"
export type Parts = Array<{ type: "text" | "reasoning"; text: string }>

export interface ChatsTable {
  id: string
  user_id: string
  title: string
  selected_root_node_id: string | null
  model_config_json: string
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
export interface InstanceTable {
  id: number
  owner_user_id: string | null
  system_prompt: string
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
export interface DB {
  chats: ChatsTable
  message_nodes: MessageNodesTable
  instance: InstanceTable
  provider_profiles: ProviderProfilesTable
  model_catalog_cache: ModelCatalogCacheTable
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
