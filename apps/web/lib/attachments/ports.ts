/**
 * Binary-object boundary. Records stay in the application database; adapters
 * only own the bytes so S3 can replace the filesystem without a data-model change.
 */
export type AttachmentStorageBackend = "filesystem" | "database"

export type StoredBinary = {
  storageKey: string | null
  data: Uint8Array | null
}

export interface AttachmentStoragePort {
  readonly kind: AttachmentStorageBackend
  put(input: { sha256: string; data: Uint8Array }): Promise<StoredBinary>
  read(input: StoredBinary): Promise<Uint8Array>
  remove(input: { storageKey: string | null }): Promise<void>
}
