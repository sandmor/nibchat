import {
  MAX_COLLECTION,
  MAX_FILE_ATTACHMENT_BYTES,
  MAX_UPLOAD_CHUNK_BYTES,
} from "@/lib/limits"
import {
  sha256,
  type ImportManifest,
  type ImportNode,
  type ImportOutcome,
  type ImportSourcePort,
  type ImportTransportPort,
} from "./model"

export class ImportPaused extends Error {}

/** The same coordinator can be hosted by a browser or a durable job runner. */
export async function runImportConversation(
  id: string,
  source: ImportSourcePort,
  transport: ImportTransportPort,
  signal: AbortSignal
): Promise<ImportOutcome> {
  const check = () => {
    if (signal.aborted) throw new ImportPaused("Import paused")
  }
  check()
  const conversation = await source.conversation(id)
  const manifest: ImportManifest = {
    sourceId: conversation.sourceId,
    fingerprint: conversation.fingerprint,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    nodeCount: conversation.nodeCount,
    selectedRootId: conversation.selectedRootId,
  }
  const begun = await transport.begin(manifest)
  if (begun.status !== "staging") return begun
  for (const asset of conversation.assets) {
    check()
    const progress = await transport.assetStatus(id, asset)
    if (progress.ready) continue
    let bytes: Uint8Array | undefined
    try {
      bytes = await source.asset(asset.id)
    } catch (error) {
      await transport.omitAsset(
        id,
        asset,
        error instanceof Error ? error.message : "The file could not be read"
      )
      continue
    }
    if (
      !bytes ||
      bytes.length === 0 ||
      bytes.length > MAX_FILE_ATTACHMENT_BYTES
    ) {
      await transport.omitAsset(
        id,
        asset,
        !bytes
          ? "The export does not contain this file"
          : bytes.length === 0
            ? "The file is empty"
            : "The file exceeds the 10 MiB attachment limit"
      )
      continue
    }
    for (
      let offset = progress.offset;
      offset < bytes.length;
      offset += MAX_UPLOAD_CHUNK_BYTES
    ) {
      check()
      await transport.assetChunk(
        id,
        asset,
        offset,
        bytes.slice(offset, offset + MAX_UPLOAD_CHUNK_BYTES)
      )
    }
    check()
    const finished = await transport.finishAsset(
      id,
      asset,
      bytes.length,
      await sha256(bytes)
    )
    if (finished.status === "rejected") {
      await transport.omitAsset(id, asset, finished.reason)
    }
  }
  for (let offset = begun.nextNode; offset < conversation.nodes.length; ) {
    check()
    const batch = []
    let size = 0
    while (
      offset + batch.length < conversation.nodes.length &&
      batch.length < MAX_COLLECTION
    ) {
      const node: ImportNode = conversation.nodes[offset + batch.length]!
      const nodeSize = new TextEncoder().encode(JSON.stringify(node)).length
      if (nodeSize > MAX_UPLOAD_CHUNK_BYTES)
        throw new Error("A message exceeds the 1 MiB import request limit")
      if (size + nodeSize > MAX_UPLOAD_CHUNK_BYTES) break
      batch.push(node)
      size += nodeSize
    }
    await transport.nodes(id, offset, batch)
    offset += batch.length
  }
  check()
  return transport.publish(id, conversation.fingerprint)
}
