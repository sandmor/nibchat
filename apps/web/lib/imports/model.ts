import { z } from "zod"
import {
  MAX_COLLECTION,
  MAX_DESCRIPTION,
  MAX_ID,
  MAX_IMPORT_NODES,
  MAX_NAME,
  MAX_PROMPT_CHARS,
} from "@/lib/limits"

const identity = z.string().min(1).max(MAX_ID)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const aliases = z.array(identity).max(MAX_COLLECTION).optional()
const promptText = z.string().max(MAX_PROMPT_CHARS)
function collectionRecord<Value extends z.ZodType>(value: Value) {
  return z
    .record(z.string(), value)
    .refine((record) => Object.keys(record).length <= MAX_COLLECTION)
}
export const sourceSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
export const manifestSchema = z.object({
  sourceId: identity,
  fingerprint: hash,
  title: z.string().max(MAX_NAME).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  nodeCount: z.number().int().min(1).max(MAX_IMPORT_NODES),
  selectedRootId: identity.nullable(),
  sourceAliases: aliases,
  variables: collectionRecord(z.union([promptText, z.boolean()])).optional(),
})
const speakerSchema = z.object({
  name: z.string().min(1).max(MAX_NAME),
  sourceAvatarId: identity.optional(),
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
  sourceModel: z.string().max(MAX_ID).optional(),
  speaker: speakerSchema.optional(),
  excluded: z.boolean(),
})
export const importEntitySchema = z.object({
  id: identity,
  aliases,
  label: z.string().min(1).max(MAX_NAME),
  kind: z.enum(["character", "group", "unassociated"]),
  description: z.string().max(MAX_DESCRIPTION).optional(),
  variables: collectionRecord(promptText).optional(),
  metadata: collectionRecord(z.unknown()).optional(),
})
export const inspectConversationSchema = z.object({
  sourceId: identity,
  sourceAliases: aliases,
  fingerprint: hash,
})
export type ImportNode = z.infer<typeof importNodeSchema>
export type ImportManifest = z.infer<typeof manifestSchema>
export type ImportAsset = z.infer<typeof assetSchema>
export type ImportEntity = z.infer<typeof importEntitySchema>
export type ImportConversation = ImportManifest & {
  nodes: ImportNode[]
  assets: ImportAsset[]
  warnings: string[]
  entity?: ImportEntity | null
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
  sourceAliases: string[]
  entityId: string | null
  entityLabel: string | null
}
export type ImportInspection = {
  sourceId: string
  status: "new" | "skipped" | "changed"
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
  /** Characters/groups that exist even when the export has no chats. */
  entities?(archive: ImportArchivePort): AsyncIterable<ImportEntity>
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
