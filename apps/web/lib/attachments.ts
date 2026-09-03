import "server-only"
import { createHash } from "node:crypto"
import { db } from "@/lib/db"
import { attachmentStorage } from "@/lib/attachments/default-port"
import { createDatabaseAttachmentStoragePort } from "@/lib/attachments/adapters/database"
import { createFilesystemAttachmentStoragePort } from "@/lib/attachments/adapters/filesystem"
import { validateAttachmentBlob } from "@/lib/file-signatures"
import { pdfAnalysisFromRow, type PdfAnalysis } from "@/lib/pdf-analysis"
import type { AttachmentStorageBackend } from "@/lib/attachments/ports"
import {
  MAX_FILE_ATTACHMENT_BYTES,
  MAX_FILE_ATTACHMENTS,
  MAX_FILE_ATTACHMENT_TOTAL_BYTES,
  type AttachmentPart,
  type AttachmentReference,
} from "@/lib/types"

export type { AttachmentStorageBackend } from "@/lib/attachments/ports"

const PENDING_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000

function cleanFilename(filename: string) {
  return (
    filename.replace(/[\u0000-\u001f\u007f\\/]/g, "_").slice(0, 255) || "file"
  )
}

export function headerSafeFilename(filename: string) {
  return filename.replace(/[\u0000-\u001f\u007f"]/g, "_")
}

export async function createUploadedFile(userId: string, file: File) {
  await cleanupExpiredPendingAttachments()
  if (file.size === 0) throw new Error("File is empty")
  if (file.size > MAX_FILE_ATTACHMENT_BYTES)
    throw new Error("Files must be 10 MiB or smaller")
  const mediaType = await validateAttachmentBlob(file, file.type)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  const stored = await attachmentStorage.put({ sha256, data: bytes })
  const row = {
    id: crypto.randomUUID(),
    user_id: userId,
    filename: cleanFilename(file.name),
    media_type: mediaType,
    byte_size: bytes.byteLength,
    sha256,
    storage_backend: attachmentStorage.kind,
    storage_key: stored.storageKey,
    data: stored.data,
    claimed_at: null,
    created_at: new Date().toISOString(),
  }
  try {
    await db.insertInto("attachments").values(row).execute()
  } catch (error) {
    if (stored.storageKey) await removeFileIfUnreferenced(stored.storageKey)
    throw error
  }
  return row
}

export async function getAttachmentForOwner(userId: string, id: string) {
  const row = await db
    .selectFrom("attachments")
    .selectAll()
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!row) throw new Error("Attachment not found")
  return row
}

/** Internal generation lookup: only message-referenced uploads may reach a model. */
export async function getAttachedAttachment(id: string) {
  const row = await db
    .selectFrom("attachments")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst()
  if (!row) throw new Error("An attached file is no longer available")
  const reference = await db
    .selectFrom("message_attachments")
    .select("attachment_id")
    .where("attachment_id", "=", id)
    .executeTakeFirst()
  if (!reference) throw new Error("An attached file is no longer available")
  return row
}

export async function readAttachment(
  row: Awaited<ReturnType<typeof getAttachmentForOwner>>
) {
  const storage = storageFor(row.storage_backend)
  try {
    return await storage.read({ storageKey: row.storage_key, data: row.data })
  } catch {
    throw new Error(`Attachment data is missing: ${row.filename}`)
  }
}

export async function resolveUploadedAttachments(
  userId: string,
  references: AttachmentReference[]
) {
  const ids = references
    .filter(
      (r): r is Extract<AttachmentReference, { kind: "uploaded-file" }> =>
        r.kind === "uploaded-file"
    )
    .map((r) => r.id)
  if (!ids.length) return []
  if (ids.length > MAX_FILE_ATTACHMENTS)
    throw new Error("You can attach up to four files")
  if (new Set(ids).size !== ids.length)
    throw new Error("A file was attached more than once")
  const rows = await db
    .selectFrom("attachments")
    .selectAll()
    .where("user_id", "=", userId)
    .where("id", "in", ids)
    .execute()
  if (rows.length !== ids.length)
    throw new Error("One or more file uploads are unavailable")
  const total = rows.reduce((sum, row) => sum + row.byte_size, 0)
  if (total > MAX_FILE_ATTACHMENT_TOTAL_BYTES)
    throw new Error("Attached files must total 20 MiB or less")
  const byId = new Map(rows.map((row) => [row.id, row]))
  const derivations = await db
    .selectFrom("attachment_derivations")
    .selectAll()
    .where("attachment_id", "in", ids)
    .execute()
  const derivationById = new Map(
    derivations.map((row) => [row.attachment_id, row])
  )
  return ids.map((id) => {
    const row = byId.get(id)!
    if (row.media_type === "application/pdf") {
      const analysis = pdfAnalysisFromRow(derivationById.get(id)?.data_json)
      return {
        type: "attachment" as const,
        id: row.id,
        name: row.filename,
        source: { kind: "upload" as const },
        content: {
          kind: "document" as const,
          attachmentId: row.id,
          mediaType: "application/pdf" as const,
          byteSize: row.byte_size,
          sha256: row.sha256,
          analysis,
        },
      } satisfies AttachmentPart
    }
    return {
      type: "attachment" as const,
      id: row.id,
      name: row.filename,
      source: { kind: "upload" as const },
      content: {
        kind: "binary" as const,
        attachmentId: row.id,
        mediaType: row.media_type,
        byteSize: row.byte_size,
        sha256: row.sha256,
      },
    } satisfies AttachmentPart
  })
}

export async function claimUploadedAttachments(
  userId: string,
  messageNodeId: string,
  attachments: AttachmentPart[],
  trx = db
) {
  const ids = attachments.flatMap((part) =>
    part.content.kind === "binary" || part.content.kind === "document"
      ? [part.content.attachmentId]
      : []
  )
  if (!ids.length) return
  const rows = await trx
    .selectFrom("attachments")
    .select(["id", "claimed_at"])
    .where("user_id", "=", userId)
    .where("id", "in", ids)
    .execute()
  if (rows.length !== ids.length)
    throw new Error("One or more file uploads are unavailable")
  const unclaimed = rows
    .filter((row) => row.claimed_at == null)
    .map((row) => row.id)
  if (unclaimed.length) {
    const result = await trx
      .updateTable("attachments")
      .set({ claimed_at: new Date().toISOString() })
      .where("user_id", "=", userId)
      .where("claimed_at", "is", null)
      .where("id", "in", unclaimed)
      .executeTakeFirst()
    if (Number(result.numUpdatedRows ?? 0) !== unclaimed.length) {
      const stillThere = await trx
        .selectFrom("attachments")
        .select("id")
        .where("user_id", "=", userId)
        .where("id", "in", ids)
        .execute()
      if (stillThere.length !== ids.length)
        throw new Error("One or more file uploads are unavailable")
    }
  }
  await trx
    .insertInto("message_attachments")
    .values(
      ids.map((attachment_id) => ({
        message_node_id: messageNodeId,
        attachment_id,
      }))
    )
    .execute()
}

export async function savePdfAnalysis(
  userId: string,
  id: string,
  analysis: PdfAnalysis
) {
  const attachment = await getAttachmentForOwner(userId, id)
  if (attachment.claimed_at)
    throw new Error("Attachment is already in a message")
  if (attachment.media_type !== "application/pdf")
    throw new Error("Attachment is not a PDF")
  const timestamp = new Date().toISOString()
  await db
    .insertInto("attachment_derivations")
    .values({
      attachment_id: id,
      kind: "pdf",
      data_json: JSON.stringify(analysis),
      created_at: timestamp,
      updated_at: timestamp,
    })
    .onConflict((oc) =>
      oc.column("attachment_id").doUpdateSet({
        kind: "pdf",
        data_json: JSON.stringify(analysis),
        updated_at: timestamp,
      })
    )
    .execute()
}

export async function deletePendingAttachment(userId: string, id: string) {
  const row = await db
    .selectFrom("attachments")
    .selectAll()
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .where("claimed_at", "is", null)
    .executeTakeFirst()
  if (!row) throw new Error("Pending attachment not found")
  const reference = await db
    .selectFrom("message_attachments")
    .select("attachment_id")
    .where("attachment_id", "=", id)
    .executeTakeFirst()
  if (reference) throw new Error("Attachment is already in a message")
  await db.deleteFrom("attachments").where("id", "=", id).execute()
  if (row.storage_key) await removeFileIfUnreferenced(row.storage_key)
}

/** Remove claimed rows no longer referenced by any message. */
export async function cleanupDetachedAttachments() {
  const rows = await db
    .selectFrom("attachments")
    .selectAll()
    .where("claimed_at", "is not", null)
    .execute()
  for (const row of rows) {
    const reference = await db
      .selectFrom("message_attachments")
      .select("attachment_id")
      .where("attachment_id", "=", row.id)
      .executeTakeFirst()
    if (reference) continue
    await db.deleteFrom("attachments").where("id", "=", row.id).execute()
    if (row.storage_key) await removeFileIfUnreferenced(row.storage_key)
  }
}

/** Best-effort recovery for interrupted or client-cancelled uploads. */
export async function cleanupExpiredPendingAttachments() {
  const expiredBefore = new Date(
    Date.now() - PENDING_UPLOAD_MAX_AGE_MS
  ).toISOString()
  const rows = await db
    .selectFrom("attachments")
    .selectAll()
    .where("claimed_at", "is", null)
    .where("created_at", "<", expiredBefore)
    .execute()
  for (const row of rows) {
    await db.deleteFrom("attachments").where("id", "=", row.id).execute()
    if (row.storage_key) await removeFileIfUnreferenced(row.storage_key)
  }
}

export async function removeFileIfUnreferenced(storageKey: string) {
  const other = await db
    .selectFrom("attachments")
    .select("id")
    .where("storage_key", "=", storageKey)
    .executeTakeFirst()
  if (!other) await storageForKey(storageKey).remove({ storageKey })
}

function storageFor(kind: AttachmentStorageBackend) {
  if (kind === attachmentStorage.kind) return attachmentStorage
  // Existing rows remain readable after the configured default changes.
  return kind === "database"
    ? createDatabaseAttachmentStoragePort()
    : createFilesystemAttachmentStoragePort()
}

function storageForKey(storageKey: string) {
  // Only filesystem records have external keys. It deliberately does not
  // depend on today's configured default.
  return createFilesystemAttachmentStoragePort()
}
