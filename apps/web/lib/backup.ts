import { z } from "zod"
import { appearanceSchema } from "@/lib/appearance"
import { isProviderModelsJson } from "@/lib/provider-models"
import { chatViewStateSchema } from "@/lib/chat-view-state"
import { providerConnectionConfigSchema } from "@/lib/provider-config"

const chatRowSchema = z
  .object({
    id: z.string(),
    user_id: z.string(),
    title: z.string().nullable(),
    selected_root_node_id: z.string().nullable(),
    model_config_json: z.string(),
    view_state_json: z.string().refine((value) => {
      try {
        return chatViewStateSchema.safeParse(JSON.parse(value)).success
      } catch {
        return false
      }
    }, "Invalid chat view state"),
    prompt_stack_id: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose()

const nodeRowSchema = z
  .object({
    id: z.string(),
    chat_id: z.string(),
    parent_id: z.string().nullable(),
    selected_child_id: z.string().nullable(),
    role: z.enum(["user", "assistant", "system", "tool"]),
    parts_json: z.string(),
    search_text: z.string(),
    metadata_json: z.string(),
    excluded_from_context: z.boolean(),
    status: z.enum([
      "complete",
      "streaming",
      "stopped",
      "error",
      "awaiting_input",
    ]),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose()

const providerProfileSchema = z
  .object({
    id: z.string(),
    user_id: z.string(),
    name: z.string(),
    kind: z.string(),
    config_json: z.string().refine((value) => {
      try {
        return providerConnectionConfigSchema.safeParse(JSON.parse(value))
          .success
      } catch {
        return false
      }
    }, "Invalid provider connection configuration"),
    models_json: z.string().refine(isProviderModelsJson, {
      message: "Invalid provider model preferences",
    }),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose()

const promptStackRowSchema = z
  .object({
    id: z.string(),
    user_id: z.string(),
    name: z.string(),
    stack_json: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose()

const mcpServerProfileSchema = z
  .object({
    id: z.string(),
    user_id: z.string(),
    name: z.string(),
    namespace: z.string(),
    enabled: z.boolean(),
    transport: z.enum(["streamable-http", "sse", "stdio"]),
    protocol_mode: z.enum(["auto", "modern"]),
    config_json: z.string(),
    catalog_json: z.string(),
    tool_allowlist_json: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose()

const attachmentBackupSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  filename: z.string(),
  media_type: z.string(),
  byte_size: z.number().int().nonnegative(),
  sha256: z.string(),
  claimed_at: z.string().nullable(),
  created_at: z.string(),
  /** Path of the raw file inside the backup zip (`attachments/<id>`). */
  file: z.string().regex(/^attachments\/[A-Za-z0-9._-]+$/),
})

const messageAttachmentBackupSchema = z.object({
  message_node_id: z.string(),
  attachment_id: z.string(),
})

const themeBackupSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  name: z.string(),
  document: appearanceSchema,
  created_at: z.string(),
  updated_at: z.string(),
})

const userBackupSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.union([z.boolean(), z.number().transform(Boolean)]),
  role: z.string().nullable(),
  banned: z.union([z.boolean(), z.number().transform(Boolean)]).nullable(),
  banReason: z.string().nullable(),
  banExpires: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const userPreferencesSchema = z.object({
  user_id: z.string(),
  light_theme_id: z.string(),
  dark_theme_id: z.string(),
  default_prompt_stack_id: z.string(),
  theme_mode: z.enum(["system", "light", "dark"]),
  builtin_tools_json: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})

/** Portable snapshot (no passwords, sessions, or attachment bytes).
 * Bytes live next to this manifest in the backup zip. */
export const backupSchema = z.object({
  version: z.literal(1),
  chats: z.array(chatRowSchema),
  nodes: z.array(nodeRowSchema),
  providerProfiles: z.array(providerProfileSchema).optional().default([]),
  mcpServerProfiles: z.array(mcpServerProfileSchema).optional().default([]),
  promptStacks: z.array(promptStackRowSchema).optional().default([]),
  themes: z.array(themeBackupSchema).optional().default([]),
  attachments: z.array(attachmentBackupSchema).optional().default([]),
  messageAttachments: z
    .array(messageAttachmentBackupSchema)
    .optional()
    .default([]),
  instance: z
    .object({
      titleModelConfig: z
        .object({
          providerId: z.string().min(1),
          model: z.string().min(1),
        })
        .nullable()
        .optional(),
    })
    .optional(),
  users: z.array(userBackupSchema).optional().default([]),
  userPreferences: z.array(userPreferencesSchema).optional().default([]),
  createdAt: z.string().optional(),
})

export type Backup = z.infer<typeof backupSchema>
export type BackupNode = Backup["nodes"][number]

export function parseBackup(input: unknown): Backup {
  return backupSchema.parse(input)
}

/**
 * Topological order for FK-safe inserts: a node only after its parent (or as root).
 * Parents must belong to the same node set; cycles / dangling parents throw.
 */
export function orderNodesForInsert(nodes: BackupNode[]): BackupNode[] {
  if (nodes.length === 0) return []
  const byId = new Map(nodes.map((node) => [node.id, node]))
  if (byId.size !== nodes.length)
    throw new Error("Backup contains duplicate node ids")

  for (const node of nodes) {
    if (node.parent_id && !byId.has(node.parent_id))
      throw new Error(
        `Backup node ${node.id} has parent ${node.parent_id} outside the backup`
      )
  }

  const remaining = new Set(byId.keys())
  const ordered: BackupNode[] = []

  while (remaining.size > 0) {
    const ready: string[] = []
    for (const id of remaining) {
      const node = byId.get(id)!
      if (!node.parent_id || !remaining.has(node.parent_id)) ready.push(id)
    }
    if (ready.length === 0)
      throw new Error("Backup message tree has a cycle or invalid parents")
    for (const id of ready) {
      ordered.push(byId.get(id)!)
      remaining.delete(id)
    }
  }
  return ordered
}
