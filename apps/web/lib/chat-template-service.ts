import "server-only"
import { db, toDbBool } from "@/lib/db"
import { id, now, parseJson } from "@/lib/domain"
import { searchTextFromParts } from "@/lib/agent/parts"
import { prepareChatRow, resolveSettingsForChat } from "@/lib/chat-service"
import { resolveSettings, type SettingValues } from "@/lib/chat-settings"
import {
  parseSpaceSettings,
  spaceFromRow,
  spaceSettingsToJson,
} from "@/lib/spaces"
import {
  chatTemplateFromNodes,
  chatTemplateNameSchema,
  parseChatTemplateDocument,
  templateAttachmentIds,
  type ChatTemplateDocument,
} from "@/lib/chat-template"
import { rewriteSillyTavernMacros } from "@/lib/imports/silly-tavern-macros"

async function assertTemplateOwner(userId: string, templateId: string) {
  const row = await db
    .selectFrom("chat_templates")
    .selectAll()
    .where("id", "=", templateId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!row) throw new Error("Chat template not found")
  return row
}

export async function listChatTemplates(userId: string) {
  const rows = await db
    .selectFrom("chat_templates")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("updated_at", "desc")
    .execute()
  return rows.map((row) => ({
    ...row,
    document: parseChatTemplateDocument(row.document_json),
  }))
}

export async function saveChatTemplateFromChat(input: {
  userId: string
  chatId: string
  name: string
  templateId?: string
  expectedRevision?: number
}) {
  const chat = await db
    .selectFrom("chats")
    .selectAll()
    .where("id", "=", input.chatId)
    .where("user_id", "=", input.userId)
    .executeTakeFirst()
  if (!chat) throw new Error("Chat not found")
  const active = await db
    .selectFrom("generation_runs")
    .select("id")
    .where("chat_id", "=", chat.id)
    .executeTakeFirst()
  if (active)
    throw new Error("Wait for active generations before saving a template")
  const nodes = await db
    .selectFrom("message_nodes")
    .selectAll()
    .where("chat_id", "=", chat.id)
    .orderBy("sort_key")
    .execute()
  if (
    nodes.some(
      (node) => node.status === "streaming" || node.status === "awaiting_input"
    )
  )
    throw new Error(
      "Finish or stop incomplete messages before saving a template"
    )
  if (
    nodes.some((node) =>
      parseJson<import("@/lib/types").Parts>(node.parts_json, []).some(
        (part) =>
          part.type === "tool-invocation" &&
          (part.state === "input-streaming" || part.state === "input-available")
      )
    )
  )
    throw new Error("Finish incomplete tool calls before saving a template")
  const document = chatTemplateFromNodes(
    nodes,
    chat.selected_root_node_id,
    Boolean(
      (await resolveSettingsForChat(chat, input.userId)).effective.model
        .expandMessageMacros
    )
  )
  return saveChatTemplateDocument({ ...input, document })
}

export async function saveChatTemplateDocument(input: {
  userId: string
  name: string
  document: ChatTemplateDocument
  templateId?: string
  expectedRevision?: number
  source?: Record<string, unknown>
}) {
  const name = chatTemplateNameSchema.parse(input.name)
  const document = parseChatTemplateDocument(input.document)
  const attachmentIds = templateAttachmentIds(document)
  const timestamp = now()
  return db.transaction().execute(async (trx) => {
    if (attachmentIds.length) {
      const owned = await trx
        .selectFrom("attachments")
        .select("id")
        .where("user_id", "=", input.userId)
        .where("id", "in", attachmentIds)
        .execute()
      if (owned.length !== attachmentIds.length)
        throw new Error("A template attachment is unavailable")
      await trx
        .updateTable("attachments")
        .set({ claimed_at: timestamp })
        .where("user_id", "=", input.userId)
        .where("id", "in", attachmentIds)
        .execute()
    }
    const templateId = input.templateId ?? id()
    if (input.templateId) {
      const existing = await trx
        .selectFrom("chat_templates")
        .selectAll()
        .where("id", "=", templateId)
        .where("user_id", "=", input.userId)
        .executeTakeFirst()
      if (!existing) throw new Error("Chat template not found")
      if (
        input.expectedRevision !== undefined &&
        existing.revision !== input.expectedRevision
      )
        throw new Error("Chat template changed; reload before replacing it")
      await trx
        .updateTable("chat_templates")
        .set({
          name,
          document_json: JSON.stringify(document),
          revision: existing.revision + 1,
          source_json: JSON.stringify(
            input.source ?? parseJson(existing.source_json, {})
          ),
          updated_at: timestamp,
        })
        .where("id", "=", templateId)
        .execute()
      await trx
        .deleteFrom("template_attachments")
        .where("template_id", "=", templateId)
        .execute()
    } else {
      await trx
        .insertInto("chat_templates")
        .values({
          id: templateId,
          user_id: input.userId,
          name,
          document_json: JSON.stringify(document),
          revision: 0,
          source_json: JSON.stringify(input.source ?? {}),
          created_at: timestamp,
          updated_at: timestamp,
        })
        .execute()
    }
    if (attachmentIds.length)
      await trx
        .insertInto("template_attachments")
        .values(
          attachmentIds.map((attachment_id) => ({
            template_id: templateId,
            attachment_id,
          }))
        )
        .execute()
    return trx
      .selectFrom("chat_templates")
      .selectAll()
      .where("id", "=", templateId)
      .executeTakeFirstOrThrow()
  })
}

export async function deleteChatTemplate(userId: string, templateId: string) {
  await assertTemplateOwner(userId, templateId)
  const { deleteTemplateSchedulesFor } = await import("@/lib/schedules/service")
  await db.transaction().execute(async (trx) => {
    await deleteTemplateSchedulesFor({ userId, templateId, trx })
    const spaces = await trx
      .selectFrom("spaces")
      .select(["id", "settings_json"])
      .where("user_id", "=", userId)
      .execute()
    for (const space of spaces) {
      const settings = parseSpaceSettings(space.settings_json)
      if (settings.chatTemplate?.value !== templateId) continue
      delete settings.chatTemplate
      await trx
        .updateTable("spaces")
        .set({
          settings_json: spaceSettingsToJson(settings),
          updated_at: now(),
        })
        .where("id", "=", space.id)
        .execute()
    }
    await trx
      .deleteFrom("chat_templates")
      .where("id", "=", templateId)
      .where("user_id", "=", userId)
      .execute()
  })
}

export async function renameChatTemplate(
  userId: string,
  templateId: string,
  name: string
) {
  await assertTemplateOwner(userId, templateId)
  await db
    .updateTable("chat_templates")
    .set({
      name: chatTemplateNameSchema.parse(name),
      updated_at: now(),
    })
    .where("id", "=", templateId)
    .where("user_id", "=", userId)
    .execute()
}

export async function upsertSillyTavernCharacterTemplate(input: {
  userId: string
  entityId: string
  name: string
  beginnings: string[]
  warnings?: string[]
}) {
  const messages = input.beginnings.filter((value) => Boolean(value.trim()))
  if (!messages.length) return null
  const existing = (await listChatTemplates(input.userId)).find((template) => {
    const source = parseJson<Record<string, unknown>>(template.source_json, {})
    return (
      source.kind === "sillytavern-character" &&
      source.entityId === input.entityId
    )
  })
  const nodes = messages.map((message, index) => ({
    id: `root-${index + 1}`,
    parentId: null,
    selectedChildId: null,
    sortKey: index,
    role: "assistant" as const,
    parts: [
      {
        type: "text" as const,
        text: rewriteSillyTavernMacros(message),
      },
    ],
    excludedFromContext: false,
  }))
  return saveChatTemplateDocument({
    userId: input.userId,
    ...(existing ? { templateId: existing.id } : {}),
    name: input.name,
    source: {
      kind: "sillytavern-character",
      entityId: input.entityId,
      warnings: input.warnings ?? [],
    },
    document: {
      version: 1,
      selectedRootId: nodes[0]!.id,
      expandMessageMacros: true,
      nodes,
    },
  })
}

type TemplateChatInput = {
  userId: string
  templateId?: string
  document: ChatTemplateDocument
  draftId?: string
  selectedRootId?: string | null
  selectedChildren?: Record<string, string | null>
  title?: string | null
  settings?: SettingValues
  spaceId?: string | null
  contextBookIds?: string[]
  expandMessageMacros?: boolean
}

/** Copy a template document into a new chat. A draft id records the preview once. */
export async function createChatFromTemplate(input: TemplateChatInput) {
  const spaces = await db
    .selectFrom("spaces")
    .selectAll()
    .where("user_id", "=", input.userId)
    .execute()
  const settings: SettingValues = { ...(input.settings ?? {}) }
  const resolved = resolveSettings({
    chat: settings,
    spaceId: input.spaceId ?? null,
    spaces: spaces.map(spaceFromRow),
  })
  if (resolved.locks.chatTemplate) {
    const requiredTemplateId = resolved.effective.chatTemplateId
    if ((input.templateId ?? null) !== requiredTemplateId)
      throw new Error(
        `Chat template is locked by ${resolved.locks.chatTemplate.spaceName}`
      )
    if (requiredTemplateId)
      await assertTemplateOwner(input.userId, requiredTemplateId)
  }
  // Materialize the snapshot the caller already chose. Templates are mutable
  // library entries, so re-reading one here could silently create a different
  // conversation after it was replaced (or fail after deletion).
  const document = parseChatTemplateDocument(input.document)
  const selectedRootId =
    input.selectedRootId === undefined
      ? document.selectedRootId
      : input.selectedRootId
  const sourceIds = new Set(document.nodes.map((node) => node.id))
  if (selectedRootId && !sourceIds.has(selectedRootId))
    throw new Error("Selected template root is missing")
  const expandMacros = Boolean(
    input.expandMessageMacros ?? document.expandMessageMacros
  )
  if (expandMacros) settings.expandMessageMacros = true
  const prepared = await prepareChatRow(
    input.userId,
    input.title ?? null,
    settings,
    input.spaceId
  )
  const ids = new Map(document.nodes.map((node) => [node.id, id()]))
  const selectedChildren = input.selectedChildren ?? {}
  for (const [parentId, childId] of Object.entries(selectedChildren)) {
    const child = childId
      ? document.nodes.find((node) => node.id === childId)
      : undefined
    if (!sourceIds.has(parentId) || (childId && child?.parentId !== parentId))
      throw new Error("Template branch selection is invalid")
  }
  const chat = {
    ...prepared,
    selected_root_node_id: selectedRootId ? ids.get(selectedRootId)! : null,
  }
  const bookIds = [...new Set(input.contextBookIds ?? [])]
  const attachmentIds = templateAttachmentIds(document)
  return db.transaction().execute(async (trx) => {
    if (attachmentIds.length) {
      const owned = await trx
        .selectFrom("attachments")
        .select("id")
        .where("user_id", "=", input.userId)
        .where("id", "in", attachmentIds)
        .execute()
      if (owned.length !== attachmentIds.length)
        throw new Error("Template attachment not found")
    }
    await trx.insertInto("chats").values(chat).execute()
    if (bookIds.length) {
      const owned = await trx
        .selectFrom("context_books")
        .select("id")
        .where("user_id", "=", input.userId)
        .where("id", "in", bookIds)
        .execute()
      if (owned.length !== bookIds.length)
        throw new Error("Context book not found")
      await trx
        .insertInto("chat_context_books")
        .values(
          bookIds.map((context_book_id, position) => ({
            chat_id: chat.id,
            context_book_id,
            position,
          }))
        )
        .execute()
    }
    for (const node of document.nodes) {
      const parts = node.parts
      const nodeId = ids.get(node.id)!
      const selectedChildId = Object.hasOwn(selectedChildren, node.id)
        ? selectedChildren[node.id]
        : node.selectedChildId
      await trx
        .insertInto("message_nodes")
        .values({
          id: nodeId,
          chat_id: chat.id,
          parent_id: node.parentId ? ids.get(node.parentId)! : null,
          selected_child_id: selectedChildId ? ids.get(selectedChildId)! : null,
          sort_key: node.sortKey,
          revision: 0,
          role: node.role,
          parts_json: JSON.stringify(parts),
          search_text: searchTextFromParts(parts),
          metadata_json: JSON.stringify({ templateNodeId: node.id }),
          excluded_from_context: toDbBool(node.excludedFromContext),
          status: "complete",
          created_at: chat.created_at,
          updated_at: chat.created_at,
        })
        .execute()
      const nodeAttachmentIds = [
        ...new Set(
          parts.flatMap((part) =>
            part.type === "attachment" &&
            (part.content.kind === "binary" || part.content.kind === "document")
              ? [part.content.attachmentId]
              : []
          )
        ),
      ]
      if (nodeAttachmentIds.length)
        await trx
          .insertInto("message_attachments")
          .values(
            nodeAttachmentIds.map((attachment_id) => ({
              message_node_id: nodeId,
              attachment_id,
            }))
          )
          .execute()
    }
    if (input.draftId)
      await trx
        .insertInto("draft_materializations")
        .values({
          user_id: input.userId,
          draft_id: input.draftId,
          chat_id: chat.id,
          created_at: chat.created_at,
        })
        .execute()
    return {
      chat,
      nodes: await trx
        .selectFrom("message_nodes")
        .selectAll()
        .where("chat_id", "=", chat.id)
        .execute(),
      nodeIds: Object.fromEntries(ids),
    }
  })
}

export async function materializeChatTemplate(
  input: TemplateChatInput & { draftId: string }
) {
  const previous = await db
    .selectFrom("draft_materializations")
    .select("chat_id")
    .where("user_id", "=", input.userId)
    .where("draft_id", "=", input.draftId)
    .executeTakeFirst()
  if (previous) {
    const chat = await db
      .selectFrom("chats")
      .selectAll()
      .where("id", "=", previous.chat_id)
      .where("user_id", "=", input.userId)
      .executeTakeFirstOrThrow()
    const nodes = await db
      .selectFrom("message_nodes")
      .selectAll()
      .where("chat_id", "=", chat.id)
      .execute()
    const nodeIds = Object.fromEntries(
      nodes.flatMap((node) => {
        const source = parseJson<Record<string, unknown>>(
          node.metadata_json,
          {}
        ).templateNodeId
        return typeof source === "string" ? [[source, node.id]] : []
      })
    )
    return { chat, nodes, nodeIds }
  }
  try {
    return await createChatFromTemplate(input)
  } catch (error) {
    const winner = await db
      .selectFrom("draft_materializations")
      .select("chat_id")
      .where("user_id", "=", input.userId)
      .where("draft_id", "=", input.draftId)
      .executeTakeFirst()
    if (!winner) throw error
    const chat = await db
      .selectFrom("chats")
      .selectAll()
      .where("id", "=", winner.chat_id)
      .where("user_id", "=", input.userId)
      .executeTakeFirstOrThrow()
    const nodes = await db
      .selectFrom("message_nodes")
      .selectAll()
      .where("chat_id", "=", chat.id)
      .execute()
    return {
      chat,
      nodes,
      nodeIds: Object.fromEntries(
        nodes.flatMap((node) => {
          const source = parseJson<Record<string, unknown>>(
            node.metadata_json,
            {}
          ).templateNodeId
          return typeof source === "string" ? [[source, node.id]] : []
        })
      ),
    }
  }
}
