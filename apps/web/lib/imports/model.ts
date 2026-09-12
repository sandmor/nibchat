import { z } from "zod"
import { MAX_IMPORT_NODES, MAX_NAME } from "@/lib/limits"

const identity = z.string().min(1).max(256)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
export const sourceSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
export const manifestSchema = z.object({
  sourceId: identity,
  fingerprint: hash,
  title: z.string().max(MAX_NAME).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  nodeCount: z.number().int().min(1).max(MAX_IMPORT_NODES),
  selectedRootId: identity.nullable(),
})
export const assetSchema = z.object({
  id: identity,
  name: z.string().min(1).max(255),
  mediaType: z.string().max(128),
})
export const importPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("reasoning"), text: z.string() }),
  z.object({ type: z.literal("asset"), assetId: identity }),
])
export const importNodeSchema = z.object({
  id: identity,
  parentId: identity.nullable(),
  selectedChildId: identity.nullable(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  parts: z.array(importPartSchema).min(1),
  createdAt: z.string().datetime(),
  sourceModel: z.string().max(256).optional(),
  excluded: z.boolean(),
})
export type ImportNode = z.infer<typeof importNodeSchema>
export type ImportManifest = z.infer<typeof manifestSchema>
export type ImportAsset = z.infer<typeof assetSchema>
export type ImportConversation = ImportManifest & {
  nodes: ImportNode[]
  assets: ImportAsset[]
  warnings: string[]
}
export type ImportOutcome = {
  status: "imported" | "skipped" | "changed"
  chatId: string | null
}
export type ImportAssetFinish =
  | { status: "ready" }
  | { status: "rejected"; reason: string }
export type ImportRecord = {
  sourceId: string
  title: string
  updatedAt: string
  nodeCount: number
  assetCount: number
  warnings: string[]
  fingerprint: string
}
export type ImportFilter = {
  query: string
  content: boolean
  after: string
  before: string
  attachments: boolean
  order: "newest" | "oldest"
}
export const emptyImportFilter: ImportFilter = {
  query: "",
  content: false,
  after: "",
  before: "",
  attachments: false,
  order: "newest",
}

/** No browser, HTTP, database, or provider-specific types cross these ports. */
export interface ImportArchivePort {
  names(): string[]
  size(name: string): number
  stream(name: string): Promise<ReadableStream<Uint8Array>>
}
export interface ImportFormatPort {
  readonly id: string
  readonly version: number
  readonly label: string
  conversations(archive: ImportArchivePort): AsyncIterable<ImportConversation>
  assetEntry(archive: ImportArchivePort, id: string): string | undefined
}
export interface ImportSourcePort {
  conversation(id: string): Promise<ImportConversation>
  asset(id: string): Promise<Uint8Array | undefined>
}
export interface ImportTransportPort {
  begin(
    manifest: ImportManifest
  ): Promise<ImportOutcome | { status: "staging"; nextNode: number }>
  assetStatus(
    conversationId: string,
    asset: ImportAsset
  ): Promise<{ offset: number; ready: boolean }>
  assetChunk(
    conversationId: string,
    asset: ImportAsset,
    offset: number,
    bytes: Uint8Array
  ): Promise<void>
  finishAsset(
    conversationId: string,
    asset: ImportAsset,
    byteSize: number,
    sha256: string
  ): Promise<ImportAssetFinish>
  omitAsset(
    conversationId: string,
    asset: ImportAsset,
    reason: string
  ): Promise<void>
  nodes(
    conversationId: string,
    offset: number,
    nodes: ImportNode[]
  ): Promise<void>
  publish(conversationId: string, fingerprint: string): Promise<ImportOutcome>
}

export async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}
