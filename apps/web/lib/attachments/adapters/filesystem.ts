import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { monorepoRoot } from "@/lib/db/paths"
import type { AttachmentStoragePort } from "@/lib/attachments/ports"

function root() {
  const configured =
    process.env.ATTACHMENT_FILESYSTEM_PATH ?? "./data/attachments"
  return path.isAbsolute(configured)
    ? configured
    : path.join(/* turbopackIgnore: true */ monorepoRoot(), configured)
}

export function createFilesystemAttachmentStoragePort(): AttachmentStoragePort {
  return {
    kind: "filesystem",
    async put({ sha256, data }) {
      const storageKey = path.join(sha256.slice(0, 2), sha256)
      const target = path.join(/* turbopackIgnore: true */ root(), storageKey)
      await mkdir(path.dirname(target), { recursive: true })
      try {
        await stat(/* turbopackIgnore: true */ target)
      } catch {
        const temporary = `${target}.${randomUUID()}.tmp`
        await writeFile(temporary, data, { flag: "wx" })
        try {
          await rename(temporary, target)
        } catch (error) {
          await rm(temporary, { force: true })
          throw error
        }
      }
      return { storageKey, data: null }
    },
    async read({ storageKey }) {
      if (!storageKey) throw new Error("Attachment storage key is missing")
      try {
        return new Uint8Array(
          await readFile(
            /* turbopackIgnore: true */ path.join(
              /* turbopackIgnore: true */ root(),
              storageKey
            )
          )
        )
      } catch {
        throw new Error("Attachment file is missing")
      }
    },
    async remove({ storageKey }) {
      if (storageKey)
        await rm(path.join(/* turbopackIgnore: true */ root(), storageKey), {
          force: true,
        })
    },
  }
}
