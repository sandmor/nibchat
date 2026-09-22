import { z } from "zod"
import { messagePartSchema, type Parts } from "@/lib/agent/parts"
import { parseJson, resolveActivePath } from "@/lib/domain"
import { MAX_ID, MAX_IMPORT_NODES, MAX_NAME } from "@/lib/limits"
import type { NodeRow } from "@/lib/types"

const templateNodeId = z.string().min(1).max(MAX_ID)

const templateNodeSchema = z.object({
  id: templateNodeId,
  parentId: templateNodeId.nullable(),
  selectedChildId: templateNodeId.nullable(),
  sortKey: z.number(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  parts: z.array(messagePartSchema),
  excludedFromContext: z.boolean(),
})

export const chatTemplateDocumentSchema = z
  .object({
    version: z.literal(1),
    selectedRootId: templateNodeId.nullable(),
    expandMessageMacros: z.boolean().default(false),
    nodes: z.array(templateNodeSchema).max(MAX_IMPORT_NODES),
  })
  .superRefine((document, context) => {
    const ids = new Set(document.nodes.map((node) => node.id))
    if (ids.size !== document.nodes.length) {
      context.addIssue({
        code: "custom",
        message: "Template node IDs must be unique",
      })
      return
    }
    if (document.selectedRootId && !ids.has(document.selectedRootId))
      context.addIssue({ code: "custom", message: "Selected root is missing" })
    const byId = new Map(document.nodes.map((node) => [node.id, node]))
    for (const node of document.nodes) {
      if (node.parentId && !ids.has(node.parentId))
        context.addIssue({
          code: "custom",
          message: `Parent is missing for ${node.id}`,
        })
      const child = node.selectedChildId
        ? byId.get(node.selectedChildId)
        : undefined
      if (node.selectedChildId && child?.parentId !== node.id)
        context.addIssue({
          code: "custom",
          message: `Selected child is invalid for ${node.id}`,
        })
    }
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (id: string) => {
      if (visiting.has(id)) {
        context.addIssue({
          code: "custom",
          message: "Template graph contains a cycle",
        })
        return
      }
      if (visited.has(id)) return
      visiting.add(id)
      const parent = byId.get(id)?.parentId
      if (parent) visit(parent)
      visiting.delete(id)
      visited.add(id)
    }
    for (const id of ids) visit(id)
  })

export type ChatTemplateDocument = z.infer<typeof chatTemplateDocumentSchema>
export type ChatTemplateNode = ChatTemplateDocument["nodes"][number]

export function templateActiveLeaf(document: {
  selectedRootId: string | null
  nodes: ReadonlyArray<{
    id: string
    parentId: string | null
    selectedChildId: string | null
    sortKey: number
    role: NodeRow["role"]
  }>
}) {
  const nodes = document.nodes.map(
    (node) =>
      ({
        id: node.id,
        chat_id: "",
        parent_id: node.parentId,
        selected_child_id: node.selectedChildId,
        sort_key: node.sortKey,
        revision: 0,
        role: node.role,
        parts_json: "[]",
        search_text: "",
        metadata_json: "{}",
        excluded_from_context: false,
        status: "complete",
        created_at: "",
        updated_at: "",
      }) satisfies NodeRow
  )
  return resolveActivePath(nodes, document.selectedRootId).at(-1)
}
export const chatTemplateNameSchema = z.string().trim().min(1).max(MAX_NAME)

function portableParts(parts: Parts): Parts {
  return parts.map((part) => {
    if (part.type === "attachment") return part
    const portable = { ...part }
    delete portable.providerMetadata
    if (portable.type === "text" || portable.type === "reasoning")
      delete portable.streamId
    return portable
  })
}

export function parseChatTemplateDocument(value: string | unknown) {
  return chatTemplateDocumentSchema.parse(
    typeof value === "string" ? parseJson<unknown>(value, null) : value
  )
}

export function chatTemplateFromNodes(
  nodes: NodeRow[],
  selectedRootId: string | null,
  expandMessageMacros: boolean
): ChatTemplateDocument {
  return chatTemplateDocumentSchema.parse({
    version: 1,
    selectedRootId,
    expandMessageMacros,
    nodes: nodes.map((node) => ({
      id: node.id,
      parentId: node.parent_id,
      selectedChildId: node.selected_child_id,
      sortKey: node.sort_key,
      role: node.role,
      parts: portableParts(parseJson<Parts>(node.parts_json, [])),
      excludedFromContext: Boolean(node.excluded_from_context),
    })),
  })
}

export function templateAttachmentIds(document: ChatTemplateDocument) {
  return [
    ...new Set(
      document.nodes.flatMap((node) =>
        node.parts.flatMap((part) =>
          part.type === "attachment" &&
          (part.content.kind === "binary" || part.content.kind === "document")
            ? [part.content.attachmentId]
            : []
        )
      )
    ),
  ]
}
