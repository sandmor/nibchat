import { z } from "zod"
import { appearanceSchema } from "@/lib/appearance"

const chatRowSchema = z
  .object({
    id: z.string(),
    user_id: z.string().optional(),
    title: z.string(),
    selected_root_node_id: z.string().nullable(),
    model_config_json: z.string(),
    prompt_stack_id: z.string().nullable().optional(),
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
    user_id: z.string().optional(),
    name: z.string(),
    kind: z.string(),
    base_url: z.string().nullable().optional(),
    api_key_env: z.string().nullable().optional(),
    models_json: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose()

const promptStackRowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    stack_json: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose()

const mcpServerProfileSchema = z
  .object({
    id: z.string(),
    user_id: z.string().optional(),
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

/** Full-instance portable snapshot (no API keys). Stack docs validated on restore/export. */
export const backupSchema = z.object({
  version: z.literal(1),
  chats: z.array(chatRowSchema),
  nodes: z.array(nodeRowSchema),
  providerProfiles: z.array(providerProfileSchema).optional().default([]),
  mcpServerProfiles: z.array(mcpServerProfileSchema).optional().default([]),
  promptStacks: z.array(promptStackRowSchema).optional().default([]),
  appearance: appearanceSchema.optional(),
  instance: z
    .object({
      default_prompt_stack_id: z.string().optional(),
      appearance: appearanceSchema.optional(),
    })
    .optional(),
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
