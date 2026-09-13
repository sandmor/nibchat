import "server-only"
import { createHash } from "node:crypto"
import { db, toDbBool } from "@/lib/db"
import { id, now, parseJson } from "@/lib/domain"
import {
  AttachmentValidationError,
  createUploadedBytes,
  claimUploadedAttachments,
} from "@/lib/attachments"
import { messagePartsSchema, searchTextFromParts } from "@/lib/agent/parts"
import { prepareChatRow, createSpace } from "@/lib/chat-service"
import type { AttachmentPart, ImportAssetsTable, Parts } from "@/lib/types"
import { MAX_ATTACHMENT_TEXT_CHARS } from "@/lib/types"
import {
  MAX_COLLECTION,
  MAX_DESCRIPTION,
  MAX_FILE_ATTACHMENT_BYTES,
  MAX_PENDING_MS,
  MAX_UPLOAD_CHUNK_BYTES,
} from "@/lib/limits"
import type {
  ImportAsset,
  ImportInspection,
  ImportManifest,
  ImportNode,
  ImportOutcome,
} from "@/lib/imports/model"
import type { SpaceSettings } from "@/lib/space"

type Scope = {
  userId: string
  source: string
  parserVersion: number
  conversationId: string
}

async function session(scope: Scope) {
  return db
    .selectFrom("import_sessions")
    .selectAll()
    .where("user_id", "=", scope.userId)
    .where("source", "=", scope.source)
    .where("parser_version", "=", scope.parserVersion)
    .where("source_conversation_id", "=", scope.conversationId)
    .executeTakeFirst()
}

async function sessionAtAnyVersion(scope: Scope) {
  return db
    .selectFrom("import_sessions")
    .selectAll()
    .where("user_id", "=", scope.userId)
    .where("source", "=", scope.source)
    .where("source_conversation_id", "=", scope.conversationId)
    .executeTakeFirst()
}

async function receiptForIds(
  userId: string,
  source: string,
  ids: readonly string[]
) {
  if (!ids.length) return undefined
  return db
    .selectFrom("import_receipts")
    .select(["chat_id", "source_fingerprint", "source_conversation_id"])
    .where("user_id", "=", userId)
    .where("source", "=", source)
    .where("source_conversation_id", "in", ids)
    .executeTakeFirst()
}

async function receipt(scope: Scope) {
  return receiptForIds(scope.userId, scope.source, [scope.conversationId])
}

export async function inspectImports(input: {
  userId: string
  source: string
  conversations: Array<{
    sourceId: string
    sourceAliases?: string[]
    fingerprint: string
  }>
}): Promise<ImportInspection[]> {
  const ids = [
    ...new Set(
      input.conversations.flatMap((conversation) => [
        conversation.sourceId,
        ...(conversation.sourceAliases ?? []),
      ])
    ),
  ]
  const rows = ids.length
    ? await db
        .selectFrom("import_receipts")
        .select(["chat_id", "source_fingerprint", "source_conversation_id"])
        .where("user_id", "=", input.userId)
        .where("source", "=", input.source)
        .where("source_conversation_id", "in", ids)
        .execute()
    : []
  const byId = new Map(
    rows.map((row) => [row.source_conversation_id, row] as const)
  )
  return input.conversations.map((conversation) => {
    const prior = [conversation.sourceId, ...(conversation.sourceAliases ?? [])]
      .map((id) => byId.get(id))
      .find((row) => row?.chat_id)
    if (!prior?.chat_id)
      return { sourceId: conversation.sourceId, status: "new" as const }
    return {
      sourceId: conversation.sourceId,
      status:
        prior.source_fingerprint === conversation.fingerprint
          ? ("skipped" as const)
          : ("changed" as const),
    }
  })
}

export async function getOrCreateImportSpace(
  userId: string,
  source: string,
  label: string
) {
  const rows = await db
    .selectFrom("spaces")
    .selectAll()
    .where("user_id", "=", userId)
    .execute()
  const existing = rows.find(
    (row) =>
      parseJson<Record<string, unknown>>(row.metadata_json, {}).importSource ===
      source
  )
  if (existing) return existing
  const created = await createSpace({
    userId,
    name: `${label} Imports`,
    description: `Imported ${label} conversations`,
  })
  const metadata_json = JSON.stringify({ importSource: source })
  await db
    .updateTable("spaces")
    .set({ metadata_json })
    .where("id", "=", created.id)
    .execute()
  return { ...created, metadata_json }
}

/** Existing mappings are exposed only with spaces owned by the requesting user.
 * This is presentation data; resolution remains the authority for reuse. */
export async function listImportSpaceMappings(userId: string, source: string) {
  return db
    .selectFrom("import_space_mappings")
    .innerJoin("spaces", "spaces.id", "import_space_mappings.space_id")
    .select([
      "import_space_mappings.entity_id as entityId",
      "spaces.id as spaceId",
      "spaces.name as spaceName",
    ])
    .where("import_space_mappings.user_id", "=", userId)
    .where("import_space_mappings.source", "=", source)
    .where("spaces.user_id", "=", userId)
    .execute()
}

async function rememberImportSpace(
  userId: string,
  source: string,
  entityId: string,
  spaceId: string
) {
  await db
    .insertInto("import_space_mappings")
    .values({
      user_id: userId,
      source,
      entity_id: entityId,
      space_id: spaceId,
      created_at: now(),
    })
    .onConflict((oc) =>
      oc.columns(["user_id", "source", "entity_id"]).doUpdateSet({
        space_id: spaceId,
      })
    )
    .execute()
}

/** Resolve a durable import entity mapping. Managed spaces are only populated
 * on first creation, so a later export cannot overwrite user edits. */
export async function resolveImportSpace(input: {
  userId: string
  source: string
  entityId: string
  entityAliases?: string[]
  mode: "managed" | "existing" | "root"
  rootSpaceId: string
  label: string
  description?: string
  settings?: SpaceSettings
  metadata?: Record<string, unknown>
  override?: boolean
}) {
  const ids = [input.entityId, ...(input.entityAliases ?? [])]
  const mapped = !input.override
    ? await db
        .selectFrom("import_space_mappings")
        .select(["space_id", "entity_id"])
        .where("user_id", "=", input.userId)
        .where("source", "=", input.source)
        .where("entity_id", "in", ids)
        .executeTakeFirst()
    : undefined
  if (mapped) {
    const existing = await db
      .selectFrom("spaces")
      .selectAll()
      .where("id", "=", mapped.space_id)
      .where("user_id", "=", input.userId)
      .executeTakeFirst()
    if (existing) {
      if (mapped.entity_id !== input.entityId)
        await rememberImportSpace(
          input.userId,
          input.source,
          input.entityId,
          existing.id
        )
      return existing
    }
  }
  const root = await db
    .selectFrom("spaces")
    .select("id")
    .where("id", "=", input.rootSpaceId)
    .where("user_id", "=", input.userId)
    .executeTakeFirst()
  if (!root) throw new Error("Import root not found")
  let spaceId = input.rootSpaceId
  if (input.mode === "managed") {
    const created = await createSpace({
      userId: input.userId,
      parentId: input.rootSpaceId,
      name: input.label,
      description: input.description,
      settings: input.settings,
    })
    await db
      .updateTable("spaces")
      .set({
        metadata_json: JSON.stringify({
          import: {
            source: input.source,
            entityId: input.entityId,
            ...(input.metadata ?? {}),
          },
        }),
      })
      .where("id", "=", created.id)
      .execute()
    spaceId = created.id
  }
  await rememberImportSpace(input.userId, input.source, input.entityId, spaceId)
  return db
    .selectFrom("spaces")
    .selectAll()
    .where("id", "=", spaceId)
    .executeTakeFirstOrThrow()
}

export async function beginImport(
  scope: Scope,
  input: ImportManifest & { spaceId: string }
) {
  if (input.sourceId !== scope.conversationId) {
    throw new Error("Import conversation identity does not match")
  }
  await cleanupImportSessions()
  const prior = await receiptForIds(scope.userId, scope.source, [
    input.sourceId,
    ...(input.sourceAliases ?? []),
  ])
  if (prior?.chat_id) {
    if (prior.source_conversation_id !== input.sourceId)
      await db
        .insertInto("import_receipts")
        .values({
          user_id: scope.userId,
          source: scope.source,
          parser_version: scope.parserVersion,
          source_conversation_id: input.sourceId,
          source_fingerprint: prior.source_fingerprint,
          chat_id: prior.chat_id,
          created_at: now(),
        })
        .onConflict((oc) =>
          oc
            .columns(["user_id", "source", "source_conversation_id"])
            .doUpdateSet({
              parser_version: scope.parserVersion,
              source_fingerprint: prior.source_fingerprint,
              chat_id: prior.chat_id,
            })
        )
        .execute()
    return outcome(prior, input.fingerprint)
  }
  if (prior) await deleteReceipt(scope)
  const existing = await sessionAtAnyVersion(scope)
  if (
    existing &&
    (existing.parser_version !== scope.parserVersion ||
      existing.source_fingerprint !== input.fingerprint)
  ) {
    await db
      .deleteFrom("import_sessions")
      .where("id", "=", existing.id)
      .execute()
  }
  const current =
    existing?.parser_version === scope.parserVersion &&
    existing.source_fingerprint === input.fingerprint
      ? existing
      : undefined
  if (!current) {
    const space = await db
      .selectFrom("spaces")
      .select("id")
      .where("id", "=", input.spaceId)
      .where("user_id", "=", scope.userId)
      .executeTakeFirst()
    if (!space) throw new Error("Import space not found")
    const timestamp = now()
    await db
      .insertInto("import_sessions")
      .values({
        id: id(),
        user_id: scope.userId,
        source: scope.source,
        parser_version: scope.parserVersion,
        source_conversation_id: scope.conversationId,
        source_fingerprint: input.fingerprint,
        title: input.title,
        space_id: input.spaceId,
        source_created_at: input.createdAt,
        source_updated_at: input.updatedAt,
        node_count: input.nodeCount,
        selected_root_source_id: input.selectedRootId,
        variables_json: JSON.stringify(input.variables ?? {}),
        created_at: timestamp,
        updated_at: timestamp,
      })
      .execute()
  }
  const active = await session(scope)
  const count = active
    ? await db
        .selectFrom("import_nodes")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("session_id", "=", active.id)
        .executeTakeFirst()
    : undefined
  return { status: "staging" as const, nextNode: Number(count?.count ?? 0) }
}

export async function importAssetStatus(scope: Scope, asset: ImportAsset) {
  const active = await requireSession(scope)
  let row = await db
    .selectFrom("import_assets")
    .selectAll()
    .where("session_id", "=", active.id)
    .where("source_asset_id", "=", asset.id)
    .executeTakeFirst()
  if (!row) {
    await db
      .insertInto("import_assets")
      .values({
        session_id: active.id,
        source_asset_id: asset.id,
        filename: asset.name,
        media_type: asset.mediaType,
        byte_size: 0,
        sha256: null,
        attachment_id: null,
        state: "uploading",
        reason: null,
        data: new Uint8Array(),
      })
      .execute()
    row = await db
      .selectFrom("import_assets")
      .selectAll()
      .where("session_id", "=", active.id)
      .where("source_asset_id", "=", asset.id)
      .executeTakeFirstOrThrow()
  }
  if (
    row.filename !== asset.name ||
    (row.state === "uploading" && row.media_type !== asset.mediaType)
  )
    throw new Error("Import asset metadata changed")
  return {
    offset: row.data?.byteLength ?? row.byte_size,
    ready: row.state !== "uploading",
  }
}

export async function appendImportAsset(
  scope: Scope,
  asset: ImportAsset,
  offset: number,
  bytes: Uint8Array
) {
  if (!bytes.length || bytes.length > MAX_UPLOAD_CHUNK_BYTES)
    throw new Error("Invalid import chunk size")
  const active = await requireSession(scope)
  const row = await db
    .selectFrom("import_assets")
    .selectAll()
    .where("session_id", "=", active.id)
    .where("source_asset_id", "=", asset.id)
    .executeTakeFirst()
  if (!row || row.state !== "uploading")
    throw new Error("Import asset is not accepting data")
  const current = row.data ?? new Uint8Array()
  if (current.byteLength !== offset)
    throw new Error("Import chunk offset does not match the checkpoint")
  if (current.byteLength + bytes.byteLength > MAX_FILE_ATTACHMENT_BYTES)
    throw new Error("Import attachment exceeds 10 MiB")
  const data = new Uint8Array(current.byteLength + bytes.byteLength)
  data.set(current)
  data.set(bytes, current.byteLength)
  await db
    .updateTable("import_assets")
    .set({ data, byte_size: data.byteLength })
    .where("session_id", "=", active.id)
    .where("source_asset_id", "=", asset.id)
    .execute()
  await touch(active.id)
}

export async function finishImportAsset(
  scope: Scope,
  asset: ImportAsset,
  byteSize: number,
  sha256: string
) {
  const active = await requireSession(scope)
  const row = await db
    .selectFrom("import_assets")
    .selectAll()
    .where("session_id", "=", active.id)
    .where("source_asset_id", "=", asset.id)
    .executeTakeFirstOrThrow()
  if (row.state === "ready") return { status: "ready" as const }
  const bytes = row.data ?? new Uint8Array()
  if (
    bytes.byteLength !== byteSize ||
    createHash("sha256").update(bytes).digest("hex") !== sha256
  )
    throw new Error("Import attachment verification failed")
  if (asset.mediaType.startsWith("text/")) {
    await db
      .updateTable("import_assets")
      .set({ state: "ready", byte_size: byteSize, sha256 })
      .where("session_id", "=", active.id)
      .where("source_asset_id", "=", asset.id)
      .execute()
  } else {
    let attachment
    try {
      attachment = await createUploadedBytes(scope.userId, {
        filename: asset.name,
        declaredMediaType: asset.mediaType,
        bytes,
      })
    } catch (error) {
      if (error instanceof AttachmentValidationError)
        return { status: "rejected" as const, reason: error.message }
      throw error
    }
    await db
      .updateTable("import_assets")
      .set({
        state: "ready",
        byte_size: byteSize,
        sha256,
        media_type: attachment.media_type,
        attachment_id: attachment.id,
        data: new Uint8Array(),
      })
      .where("session_id", "=", active.id)
      .where("source_asset_id", "=", asset.id)
      .execute()
  }
  await touch(active.id)
  return { status: "ready" as const }
}

export async function omitImportAsset(
  scope: Scope,
  asset: ImportAsset,
  reason: string
) {
  const active = await requireSession(scope)
  await db
    .insertInto("import_assets")
    .values({
      session_id: active.id,
      source_asset_id: asset.id,
      filename: asset.name,
      media_type: asset.mediaType,
      byte_size: 0,
      sha256: null,
      attachment_id: null,
      state: "omitted",
      reason: reason.slice(0, MAX_DESCRIPTION),
      data: new Uint8Array(),
    })
    .onConflict((conflict) =>
      conflict.columns(["session_id", "source_asset_id"]).doUpdateSet({
        state: "omitted",
        reason: reason.slice(0, MAX_DESCRIPTION),
        data: new Uint8Array(),
      })
    )
    .execute()
  await touch(active.id)
}

export async function appendImportNodes(
  scope: Scope,
  offset: number,
  nodes: ImportNode[]
) {
  if (!nodes.length || nodes.length > MAX_COLLECTION)
    throw new Error("Invalid import node batch")
  const active = await requireSession(scope)
  const count = await db
    .selectFrom("import_nodes")
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .where("session_id", "=", active.id)
    .executeTakeFirst()
  if (Number(count?.count ?? 0) !== offset)
    throw new Error("Import node offset does not match the checkpoint")
  if (offset + nodes.length > active.node_count)
    throw new Error("Import contains more messages than declared")
  await db
    .insertInto("import_nodes")
    .values(
      nodes.map((node, index) => ({
        session_id: active.id,
        position: offset + index,
        source_node_id: node.id,
        parent_source_id: node.parentId,
        selected_child_source_id: node.selectedChildId,
        role: node.role,
        parts_json: JSON.stringify(node.parts),
        source_model: node.sourceModel ?? null,
        speaker_json: node.speaker ? JSON.stringify(node.speaker) : null,
        excluded: toDbBool(node.excluded),
        created_at: node.createdAt,
      }))
    )
    .execute()
  await touch(active.id)
}

export async function publishImport(
  scope: Scope,
  fingerprint: string
): Promise<ImportOutcome> {
  const prior = await receipt(scope)
  if (prior?.chat_id) return outcome(prior, fingerprint)
  if (prior) await deleteReceipt(scope)
  const active = await requireSession(scope)
  const stagedNodes = await db
    .selectFrom("import_nodes")
    .selectAll()
    .where("session_id", "=", active.id)
    .orderBy("position")
    .execute()
  if (stagedNodes.length !== active.node_count)
    throw new Error("Import messages are incomplete")
  const stagedAssets = await db
    .selectFrom("import_assets")
    .selectAll()
    .where("session_id", "=", active.id)
    .execute()
  if (stagedAssets.some((asset) => asset.state === "uploading"))
    throw new Error("Import attachments are incomplete")
  const chat = await prepareChatRow(
    scope.userId,
    active.title,
    undefined,
    undefined,
    undefined,
    active.space_id
  )
  const ids = new Map(stagedNodes.map((node) => [node.source_node_id, id()]))
  for (const node of stagedNodes) {
    if (node.parent_source_id && !ids.has(node.parent_source_id))
      throw new Error("Import message references an unknown parent")
    if (
      node.selected_child_source_id &&
      !ids.has(node.selected_child_source_id)
    )
      throw new Error("Import message references an unknown selected child")
  }
  if (
    active.selected_root_source_id &&
    !ids.has(active.selected_root_source_id)
  )
    throw new Error("Import references an unknown selected root")
  const attachments = new Map(
    stagedAssets.map((asset) => [asset.source_asset_id, asset])
  )
  return db.transaction().execute(async (trx) => {
    const concurrent = await trx
      .selectFrom("import_receipts")
      .select(["chat_id", "source_fingerprint"])
      .where("user_id", "=", scope.userId)
      .where("source", "=", scope.source)
      .where("source_conversation_id", "=", scope.conversationId)
      .executeTakeFirst()
    if (concurrent?.chat_id) {
      await trx
        .deleteFrom("import_sessions")
        .where("id", "=", active.id)
        .execute()
      return outcome(concurrent, active.source_fingerprint)
    }
    if (concurrent) {
      await trx
        .deleteFrom("import_receipts")
        .where("user_id", "=", scope.userId)
        .where("source", "=", scope.source)
        .where("source_conversation_id", "=", scope.conversationId)
        .execute()
    }
    await trx
      .insertInto("chats")
      .values({
        ...chat,
        variables_json: active.variables_json,
        created_at: active.source_created_at,
        updated_at: active.source_updated_at,
        selected_root_node_id: active.selected_root_source_id
          ? (ids.get(active.selected_root_source_id) ?? null)
          : ids.get(stagedNodes[0]!.source_node_id)!,
      })
      .execute()
    for (const node of stagedNodes) {
      const parts = partsFor(node.parts_json, attachments)
      messagePartsSchema.parse(parts)
      const nodeId = ids.get(node.source_node_id)!
      await trx
        .insertInto("message_nodes")
        .values({
          id: nodeId,
          chat_id: chat.id,
          parent_id: node.parent_source_id
            ? ids.get(node.parent_source_id)!
            : null,
          selected_child_id: node.selected_child_source_id
            ? (ids.get(node.selected_child_source_id) ?? null)
            : null,
          sort_key: node.position,
          revision: 0,
          role: node.role,
          parts_json: JSON.stringify(parts),
          search_text: searchTextFromParts(parts),
          metadata_json: JSON.stringify({
            import: {
              source: scope.source,
              parserVersion: scope.parserVersion,
              sourceModel: node.source_model,
              ...(node.speaker_json
                ? {
                    speaker: parseJson<Record<string, unknown>>(
                      node.speaker_json,
                      {}
                    ),
                  }
                : {}),
            },
          }),
          excluded_from_context: toDbBool(Boolean(node.excluded)),
          status: "complete",
          created_at: node.created_at,
          updated_at: node.created_at,
        })
        .execute()
      const linked = parts.filter(
        (part): part is AttachmentPart => part.type === "attachment"
      )
      if (linked.length)
        await claimUploadedAttachments(scope.userId, nodeId, linked, trx)
    }
    await trx
      .insertInto("import_receipts")
      .values({
        user_id: scope.userId,
        source: scope.source,
        parser_version: scope.parserVersion,
        source_conversation_id: scope.conversationId,
        source_fingerprint: active.source_fingerprint,
        chat_id: chat.id,
        created_at: now(),
      })
      .execute()
    await trx
      .deleteFrom("import_sessions")
      .where("id", "=", active.id)
      .execute()
    return { status: "imported", chatId: chat.id }
  })
}

function partsFor(json: string, assets: Map<string, ImportAssetsTable>): Parts {
  const parts = parseJson<
    Array<{ type: string; text?: string; assetId?: string }>
  >(json, [])
  return parts.flatMap((part): Parts => {
    if (part.type === "text" || part.type === "reasoning")
      return [{ type: part.type, text: part.text ?? "" }]
    if (part.type !== "asset" || !part.assetId) return []
    const asset = assets.get(part.assetId)
    if (!asset || asset.state === "omitted")
      return [
        {
          type: "text",
          text: `[Attachment unavailable: ${asset?.filename ?? part.assetId} — ${asset?.reason ?? "missing from export"}.]`,
        },
      ]
    if (asset.media_type.startsWith("text/")) {
      const decoded = new TextDecoder().decode(asset.data ?? new Uint8Array())
      const full = `[${asset.filename}]\n${decoded}`
      const suffix = "\n\n[Attachment text truncated during import.]"
      const text =
        full.length <= MAX_ATTACHMENT_TEXT_CHARS
          ? full
          : `${full.slice(0, MAX_ATTACHMENT_TEXT_CHARS - suffix.length)}${suffix}`
      return [
        {
          type: "text",
          text,
        },
      ]
    }
    if (!asset.attachment_id || !asset.sha256)
      return [
        { type: "text", text: `[Attachment unavailable: ${asset.filename}.]` },
      ]
    const common = {
      attachmentId: asset.attachment_id,
      byteSize: asset.byte_size,
      sha256: asset.sha256,
    }
    const content =
      asset.media_type === "application/pdf"
        ? {
            kind: "document" as const,
            ...common,
            mediaType: "application/pdf" as const,
            analysis: { status: "unavailable" as const },
          }
        : {
            kind: "binary" as const,
            ...common,
            mediaType: asset.media_type as
              | "image/jpeg"
              | "image/png"
              | "image/gif"
              | "image/webp",
          }
    return [
      {
        type: "attachment",
        id: asset.attachment_id,
        name: asset.filename,
        source: { kind: "upload" },
        content,
      },
    ]
  })
}

function outcome(
  row: { chat_id: string | null; source_fingerprint: string },
  fingerprint: string
): ImportOutcome {
  return {
    status: row.source_fingerprint === fingerprint ? "skipped" : "changed",
    chatId: row.chat_id,
  }
}
async function requireSession(scope: Scope) {
  const row = await session(scope)
  if (!row) throw new Error("Import session not found")
  return row
}
async function deleteReceipt(scope: Scope) {
  await db
    .deleteFrom("import_receipts")
    .where("user_id", "=", scope.userId)
    .where("source", "=", scope.source)
    .where("source_conversation_id", "=", scope.conversationId)
    .execute()
}
async function touch(sessionId: string) {
  await db
    .updateTable("import_sessions")
    .set({ updated_at: now() })
    .where("id", "=", sessionId)
    .execute()
}
async function cleanupImportSessions() {
  const cutoff = new Date(Date.now() - MAX_PENDING_MS).toISOString()
  await db
    .deleteFrom("import_sessions")
    .where("updated_at", "<", cutoff)
    .execute()
}
