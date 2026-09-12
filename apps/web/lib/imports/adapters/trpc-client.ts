"use client"

import { MAX_DESCRIPTION } from "@/lib/limits"
import type {
  ImportAsset,
  ImportAssetFinish,
  ImportManifest,
  ImportNode,
  ImportOutcome,
  ImportTransportPort,
} from "@/lib/imports/model"

type Scope = { source: string; parserVersion: number; conversationId: string }
type Operations = {
  begin(
    input: Scope & {
      manifest: ImportManifest & { spaceId: string }
    }
  ): Promise<ImportOutcome | { status: "staging"; nextNode: number }>
  assetStatus(
    input: Scope & { asset: ImportAsset }
  ): Promise<{ offset: number; ready: boolean }>
  assetChunk(
    input: Scope & { asset: ImportAsset; offset: number; base64: string }
  ): Promise<unknown>
  finishAsset(
    input: Scope & { asset: ImportAsset; byteSize: number; sha256: string }
  ): Promise<ImportAssetFinish>
  omitAsset(
    input: Scope & { asset: ImportAsset; reason: string }
  ): Promise<unknown>
  nodes(
    input: Scope & { offset: number; nodes: ImportNode[] }
  ): Promise<unknown>
  publish(input: Scope & { fingerprint: string }): Promise<ImportOutcome>
}

export function createTrpcImportTransport(
  source: string,
  parserVersion: number,
  spaceId: string,
  operations: Operations
): ImportTransportPort {
  const scope = (conversationId: string): Scope => ({
    source,
    parserVersion,
    conversationId,
  })
  return {
    begin: (manifest) =>
      operations.begin({
        ...scope(manifest.sourceId),
        manifest: {
          ...manifest,
          spaceId,
        },
      }),
    assetStatus: (conversationId, asset) =>
      operations.assetStatus({ ...scope(conversationId), asset }),
    assetChunk: (conversationId, asset, offset, bytes) =>
      operations
        .assetChunk({
          ...scope(conversationId),
          asset,
          offset,
          base64: base64(bytes),
        })
        .then(() => undefined),
    finishAsset: (conversationId, asset, byteSize, sha256) =>
      operations.finishAsset({
        ...scope(conversationId),
        asset,
        byteSize,
        sha256,
      }),
    omitAsset: (conversationId, asset, reason) =>
      operations
        .omitAsset({
          ...scope(conversationId),
          asset,
          reason: reason.slice(0, MAX_DESCRIPTION),
        })
        .then(() => undefined),
    nodes: (conversationId, offset, nodes) =>
      operations
        .nodes({ ...scope(conversationId), offset, nodes })
        .then(() => undefined),
    publish: (conversationId, fingerprint) =>
      operations.publish({ ...scope(conversationId), fingerprint }),
  }
}

function base64(bytes: Uint8Array) {
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 32_768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
  return btoa(binary)
}
