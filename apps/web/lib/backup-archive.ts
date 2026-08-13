import { crc32 } from "node:zlib"
import { parseBackup, type Backup } from "@/lib/backup"

export const BACKUP_MANIFEST_NAME = "backup.json"

export function attachmentArchivePath(attachmentId: string) {
  return `attachments/${attachmentId}`
}

export function packBackupArchive(
  backup: Backup,
  files: ReadonlyMap<string, Uint8Array>
) {
  for (const attachment of backup.attachments) {
    if (!files.has(attachment.file))
      throw new Error(`Backup is missing ${attachment.file}`)
  }
  const entries: ZipEntry[] = [
    {
      name: BACKUP_MANIFEST_NAME,
      data: new TextEncoder().encode(JSON.stringify(backup)),
    },
  ]
  for (const [name, data] of files) {
    assertSafeArchivePath(name)
    entries.push({ name, data })
  }
  return packStoredZip(entries)
}

export function unpackBackupArchive(bytes: Uint8Array): {
  backup: Backup
  files: Map<string, Uint8Array>
} {
  const entries = unpackStoredZip(bytes)
  const manifest = entries.get(BACKUP_MANIFEST_NAME)
  if (!manifest) throw new Error("Backup archive is missing backup.json")
  const backup = parseBackup(JSON.parse(new TextDecoder().decode(manifest)))
  const files = new Map<string, Uint8Array>()
  for (const attachment of backup.attachments) {
    const data = entries.get(attachment.file)
    if (!data) throw new Error(`Backup archive is missing ${attachment.file}`)
    files.set(attachment.file, data)
  }
  return { backup, files }
}

function assertSafeArchivePath(name: string) {
  if (
    name !== BACKUP_MANIFEST_NAME &&
    !/^attachments\/[A-Za-z0-9._-]+$/.test(name)
  )
    throw new Error(`Invalid backup archive path: ${name}`)
}

type ZipEntry = { name: string; data: Uint8Array }

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const ZIP_VERSION = 20
const METHOD_STORE = 0

function packStoredZip(entries: ZipEntry[]) {
  const chunks: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    if (entry.data.byteLength > 0xffffffff)
      throw new Error(`Backup file is too large: ${entry.name}`)
    const name = new TextEncoder().encode(entry.name)
    if (name.byteLength > 0xffff)
      throw new Error(`Backup path is too long: ${entry.name}`)
    const crc = crc32(entry.data) >>> 0
    const local = new Uint8Array(30 + name.byteLength)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, LOCAL_SIG, true)
    localView.setUint16(4, ZIP_VERSION, true)
    localView.setUint16(8, METHOD_STORE, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, entry.data.byteLength, true)
    localView.setUint32(22, entry.data.byteLength, true)
    localView.setUint16(26, name.byteLength, true)
    local.set(name, 30)
    chunks.push(local, entry.data)

    const central = new Uint8Array(46 + name.byteLength)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, CENTRAL_SIG, true)
    centralView.setUint16(4, ZIP_VERSION, true)
    centralView.setUint16(6, ZIP_VERSION, true)
    centralView.setUint16(10, METHOD_STORE, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, entry.data.byteLength, true)
    centralView.setUint32(24, entry.data.byteLength, true)
    centralView.setUint16(28, name.byteLength, true)
    centralView.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)
    offset += local.byteLength + entry.data.byteLength
  }
  const centralStart = offset
  let centralSize = 0
  for (const central of centrals) {
    chunks.push(central)
    centralSize += central.byteLength
  }
  if (entries.length > 0xffff) throw new Error("Backup has too many files")
  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, EOCD_SIG, true)
  eocdView.setUint16(8, entries.length, true)
  eocdView.setUint16(10, entries.length, true)
  eocdView.setUint32(12, centralSize, true)
  eocdView.setUint32(16, centralStart, true)
  chunks.push(eocd)
  return concat(chunks)
}

function unpackStoredZip(bytes: Uint8Array) {
  const eocdOffset = findEocd(bytes)
  const eocd = dataView(bytes, eocdOffset, 22)
  const count = eocd.getUint16(10, true)
  const centralSize = eocd.getUint32(12, true)
  const centralStart = eocd.getUint32(16, true)
  const files = new Map<string, Uint8Array>()
  let cursor = centralStart
  const centralEnd = centralStart + centralSize
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > centralEnd) throw new Error("Invalid backup archive")
    const central = dataView(bytes, cursor, 46)
    if (central.getUint32(0, true) !== CENTRAL_SIG)
      throw new Error("Invalid backup archive")
    const method = central.getUint16(10, true)
    const crc = central.getUint32(16, true)
    const size = central.getUint32(24, true)
    const nameLength = central.getUint16(28, true)
    const extraLength = central.getUint16(30, true)
    const commentLength = central.getUint16(32, true)
    const localOffset = central.getUint32(42, true)
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength)
    const name = new TextDecoder().decode(nameBytes)
    assertSafeArchivePath(name)
    if (method !== METHOD_STORE)
      throw new Error("Backup archive uses unsupported compression")
    const data = readLocalFile(bytes, localOffset, nameLength, size)
    if (crc32(data) >>> 0 !== crc)
      throw new Error(`Backup file is corrupt: ${name}`)
    files.set(name, data)
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return files
}

function readLocalFile(
  bytes: Uint8Array,
  offset: number,
  nameLength: number,
  size: number
) {
  if (offset + 30 > bytes.byteLength) throw new Error("Invalid backup archive")
  const local = dataView(bytes, offset, 30)
  if (local.getUint32(0, true) !== LOCAL_SIG)
    throw new Error("Invalid backup archive")
  const extraLength = local.getUint16(28, true)
  const start = offset + 30 + nameLength + extraLength
  const end = start + size
  if (end > bytes.byteLength) throw new Error("Invalid backup archive")
  return bytes.slice(start, end)
}

function findEocd(bytes: Uint8Array) {
  const min = 22
  if (bytes.byteLength < min) throw new Error("Invalid backup archive")
  const start = Math.max(0, bytes.byteLength - min - 0xffff)
  for (let i = bytes.byteLength - min; i >= start; i--) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      const commentLength = dataView(bytes, i, 22).getUint16(20, true)
      if (i + 22 + commentLength === bytes.byteLength) return i
    }
  }
  throw new Error("Invalid backup archive")
}

function dataView(bytes: Uint8Array, offset: number, length: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, length)
}

function concat(chunks: Uint8Array[]) {
  let total = 0
  for (const chunk of chunks) total += chunk.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}
