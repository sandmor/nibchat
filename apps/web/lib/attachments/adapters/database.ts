import type { AttachmentStoragePort } from "@/lib/attachments/ports"

/** Database bytes are persisted by the attachment repository with its row. */
export function createDatabaseAttachmentStoragePort(): AttachmentStoragePort {
  return {
    kind: "database",
    async put({ data }) {
      return { storageKey: null, data }
    },
    async read({ data }) {
      if (!data) throw new Error("Attachment data is missing")
      return new Uint8Array(data)
    },
    async remove() {},
  }
}
