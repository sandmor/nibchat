"use client"

import type { ImportArchivePort } from "@/lib/imports/model"

type Entry = {
  name: string
  compression: number
  compressedSize: number
  size: number
  offset: number
}

export async function openBrowserArchive(
  input: File | File[]
): Promise<ImportArchivePort> {
  const files = Array.isArray(input) ? input : [input]
  if (files.length > 1) {
    if (files.some((file) => file.name.toLowerCase().endsWith(".zip")))
      throw new Error(
        "Choose one ZIP export, or one or more JSONL and character card files"
      )
    const entries = new Map<string, File>()
    for (const [index, file] of files.entries()) {
      const name = entries.has(file.name) ? `${index}-${file.name}` : file.name
      entries.set(name, file)
    }
    return {
      names: () => [...entries.keys()],
      size: (name) => entries.get(name)?.size ?? 0,
      stream: async (name) => {
        const file = entries.get(name)
        if (!file) throw new Error("Archive entry not found")
        return file.stream()
      },
    }
  }
  const file = files[0]!
  if (!file.name.toLowerCase().endsWith(".zip")) {
    return {
      names: () => [file.name],
      size: () => file.size,
      stream: async (name) => {
        if (name !== file.name) throw new Error("Archive entry not found")
        return file.stream()
      },
    }
  }
  const tailSize = Math.min(file.size, 65_557)
  const tail = new Uint8Array(
    await file.slice(file.size - tailSize).arrayBuffer()
  )
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  let eocd = -1
  for (let index = tail.length - 22; index >= 0; index--) {
    if (tailView.getUint32(index, true) === 0x06054b50) {
      eocd = index
      break
    }
  }
  if (eocd < 0)
    throw new Error("The selected file is not a supported ZIP archive")
  const count = tailView.getUint16(eocd + 10, true)
  const directorySize = tailView.getUint32(eocd + 12, true)
  const directoryOffset = tailView.getUint32(eocd + 16, true)
  if (
    count === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  )
    throw new Error("ZIP64 exports are not supported yet")
  const directory = new Uint8Array(
    await file
      .slice(directoryOffset, directoryOffset + directorySize)
      .arrayBuffer()
  )
  const view = new DataView(
    directory.buffer,
    directory.byteOffset,
    directory.byteLength
  )
  const decoder = new TextDecoder()
  const entries = new Map<string, Entry>()
  let cursor = 0
  for (let index = 0; index < count; index++) {
    if (view.getUint32(cursor, true) !== 0x02014b50)
      throw new Error("The ZIP directory is invalid")
    const flags = view.getUint16(cursor + 8, true)
    if (flags & 1) throw new Error("Encrypted ZIP exports are not supported")
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const name = decoder.decode(
      directory.subarray(cursor + 46, cursor + 46 + nameLength)
    )
    if (name.includes("../") || name.startsWith("/"))
      throw new Error("The ZIP contains an unsafe path")
    entries.set(name, {
      name,
      compression: view.getUint16(cursor + 10, true),
      compressedSize: view.getUint32(cursor + 20, true),
      size: view.getUint32(cursor + 24, true),
      offset: view.getUint32(cursor + 42, true),
    })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return {
    names: () => [...entries.keys()],
    size: (name) => entries.get(name)?.size ?? 0,
    stream: async (name) => {
      const entry = entries.get(name)
      if (!entry) throw new Error(`Archive entry not found: ${name}`)
      const header = new DataView(
        await file.slice(entry.offset, entry.offset + 30).arrayBuffer()
      )
      if (header.getUint32(0, true) !== 0x04034b50)
        throw new Error("The ZIP entry is invalid")
      const dataOffset =
        entry.offset +
        30 +
        header.getUint16(26, true) +
        header.getUint16(28, true)
      const compressed = file
        .slice(dataOffset, dataOffset + entry.compressedSize)
        .stream()
      if (entry.compression === 0) return compressed
      if (entry.compression === 8 && typeof DecompressionStream !== "undefined")
        return compressed.pipeThrough(new DecompressionStream("deflate-raw"))
      throw new Error(
        "This ZIP compression method is not supported by your browser"
      )
    },
  }
}

export async function readArchiveEntry(
  archive: ImportArchivePort,
  name: string
) {
  const stream = await archive.stream(name)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
