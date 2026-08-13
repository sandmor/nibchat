import { describe, expect, it } from "vitest"
import { parseBackup } from "@/lib/backup"
import {
  attachmentArchivePath,
  packBackupArchive,
  unpackBackupArchive,
} from "@/lib/backup-archive"
import { looksLikeZip } from "@/lib/file-signatures"

const emptyBackup = parseBackup({
  version: 1,
  chats: [],
  nodes: [],
})

describe("backup archive", () => {
  it("round-trips raw attachment bytes without base64", () => {
    const id = "att-1"
    const file = attachmentArchivePath(id)
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const backup = parseBackup({
      version: 1,
      chats: [],
      nodes: [],
      attachments: [
        {
          id,
          filename: "shot.png",
          media_type: "image/png",
          byte_size: bytes.byteLength,
          sha256: "a".repeat(64),
          claimed_at: "t",
          created_at: "t",
          file,
        },
      ],
    })
    const zip = packBackupArchive(backup, new Map([[file, bytes]]))
    expect(looksLikeZip(zip)).toBe(true)
    expect(new TextDecoder().decode(zip).includes("iVBORw0K")).toBe(false)
    const unpacked = unpackBackupArchive(zip)
    expect(unpacked.backup.attachments[0]?.file).toBe(file)
    expect([...unpacked.files.get(file)!]).toEqual([...bytes])
  })

  it("packs a backup with no attachments", () => {
    const zip = packBackupArchive(emptyBackup, new Map())
    const unpacked = unpackBackupArchive(zip)
    expect(unpacked.backup.chats).toEqual([])
    expect(unpacked.files.size).toBe(0)
  })

  it("rejects a missing attachment file", () => {
    const backup = parseBackup({
      version: 1,
      chats: [],
      nodes: [],
      attachments: [
        {
          id: "att-1",
          filename: "shot.png",
          media_type: "image/png",
          byte_size: 1,
          sha256: "a".repeat(64),
          claimed_at: null,
          created_at: "t",
          file: "attachments/att-1",
        },
      ],
    })
    expect(() => packBackupArchive(backup, new Map())).toThrow(/missing/)
  })
})
