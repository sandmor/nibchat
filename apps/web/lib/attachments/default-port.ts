import { createDatabaseAttachmentStoragePort } from "@/lib/attachments/adapters/database"
import { createFilesystemAttachmentStoragePort } from "@/lib/attachments/adapters/filesystem"
import type { AttachmentStoragePort } from "@/lib/attachments/ports"

export function createDefaultAttachmentStoragePort(): AttachmentStoragePort {
  return process.env.ATTACHMENT_STORAGE === "database"
    ? createDatabaseAttachmentStoragePort()
    : createFilesystemAttachmentStoragePort()
}

const globalForAttachments = globalThis as unknown as {
  nibchatAttachmentStorage?: AttachmentStoragePort
}
export const attachmentStorage =
  globalForAttachments.nibchatAttachmentStorage ??
  createDefaultAttachmentStoragePort()
globalForAttachments.nibchatAttachmentStorage = attachmentStorage
