import "server-only"
import {
  reuseMcpAttachmentSnapshots,
  uniqueAttachmentReferences,
  uploadedAttachmentId,
  type AttachmentPart,
  type AttachmentReference,
  type Parts,
} from "@/lib/agent/parts"
import { resolveUploadedAttachments } from "@/lib/attachments"
import { resolveMcpResourceAttachment } from "@/lib/mcp"

function attachmentKey(part: AttachmentPart) {
  if (part.source.kind === "mcp-resource")
    return `mcp-resource\u0000${part.source.profileId}\u0000${part.source.uri}`
  const id = uploadedAttachmentId(part)
  return id ? `uploaded-file\u0000${id}` : `attachment\u0000${part.id}`
}

function referenceKey(reference: AttachmentReference) {
  return reference.kind === "mcp-resource"
    ? `${reference.kind}\u0000${reference.profileId}\u0000${reference.uri}`
    : `${reference.kind}\u0000${reference.id}`
}

export async function resolveConversationAttachments(input: {
  userId: string
  references: AttachmentReference[]
  sourceParts?: Parts
}): Promise<AttachmentPart[]> {
  const references = uniqueAttachmentReferences(input.references)
  if (!references.length) return []
  const { reused, unresolved } = reuseMcpAttachmentSnapshots(
    input.sourceParts ?? [],
    references
  )
  return [
    ...reused,
    ...(await Promise.all(
      unresolved.map((reference) => resolveMcpResourceAttachment(reference))
    )),
    ...(await resolveUploadedAttachments(input.userId, references)),
  ]
}

async function hydrateUploadParts(userId: string, parts: Parts): Promise<Parts> {
  const ids = parts.flatMap((part) =>
    part.type === "attachment" ? (uploadedAttachmentId(part) ?? []) : []
  )
  if (!ids.length) return parts
  const hydrated = await resolveUploadedAttachments(
    userId,
    ids.map((id) => ({ kind: "uploaded-file" as const, id }))
  )
  const byId = new Map(
    hydrated.map((part) => [uploadedAttachmentId(part), part] as const)
  )
  return parts.map((part) => {
    if (part.type !== "attachment") return part
    const id = uploadedAttachmentId(part)
    return (id ? byId.get(id) : undefined) ?? part
  })
}

function mergeAttachmentParts(parts: Parts, extras: AttachmentPart[]): Parts {
  const seen = new Set(
    parts.flatMap((part) =>
      part.type === "attachment" ? [attachmentKey(part)] : []
    )
  )
  const next = parts.slice()
  for (const part of extras) {
    const key = attachmentKey(part)
    if (seen.has(key)) continue
    seen.add(key)
    next.push(part)
  }
  return next
}

/** Resolve sidecar attachment references and replace client upload metadata
 * with the rows the owner actually uploaded. */
export async function hydrateAuthoredParts(input: {
  userId: string
  parts: Parts
  attachments?: AttachmentReference[]
  sourceParts?: Parts
}): Promise<Parts> {
  const hydrated = await hydrateUploadParts(input.userId, input.parts)
  const resolved = await resolveConversationAttachments({
    userId: input.userId,
    references: input.attachments ?? [],
    sourceParts: input.sourceParts ?? hydrated,
  })
  return mergeAttachmentParts(hydrated, resolved)
}
