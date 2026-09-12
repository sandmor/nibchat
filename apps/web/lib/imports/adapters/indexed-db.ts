"use client"

import { MAX_COLLECTION, MAX_FILE_ATTACHMENT_BYTES } from "@/lib/limits"
import { readArchiveEntry } from "@/lib/imports/adapters/browser-archive"
import {
  type ImportArchivePort,
  type ImportConversation,
  type ImportFilter,
  type ImportFormatPort,
  type ImportRecord,
  type ImportSourcePort,
} from "@/lib/imports/model"

type StoredSearch = { sourceId: string; searchText: string }
type PendingRecord = {
  conversation: ImportConversation
  record: ImportRecord
  search: StoredSearch
}

export class IndexedImportStore {
  private constructor(
    private readonly db: IDBDatabase,
    private readonly format: ImportFormatPort
  ) {}

  static async open(format: ImportFormatPort) {
    const request = indexedDB.open(
      `nibchat-import-${format.id}`,
      format.version
    )
    request.onupgradeneeded = () => {
      for (const name of ["conversations", "records", "search"]) {
        if (request.result.objectStoreNames.contains(name)) {
          request.result.deleteObjectStore(name)
        }
      }
      request.result.createObjectStore("conversations", {
        keyPath: "sourceId",
      })
      request.result.createObjectStore("records", { keyPath: "sourceId" })
      request.result.createObjectStore("search", { keyPath: "sourceId" })
    }
    return new IndexedImportStore(await idb<IDBDatabase>(request), format)
  }

  async index(
    archive: ImportArchivePort,
    progress: (record: ImportRecord) => void
  ) {
    await transaction(
      this.db,
      ["conversations", "records", "search"],
      "readwrite",
      async (tx) => {
        await Promise.all([
          request(tx.objectStore("conversations").clear()),
          request(tx.objectStore("records").clear()),
          request(tx.objectStore("search").clear()),
        ])
      }
    )
    let count = 0
    const pending: PendingRecord[] = []
    for await (const conversation of this.format.conversations(archive)) {
      const searchText = conversation.nodes
        .flatMap((node) =>
          node.parts.flatMap((part) =>
            part.type === "text" || part.type === "reasoning" ? part.text : []
          )
        )
        .join("\n")
        .toLocaleLowerCase()
      const record: ImportRecord = {
        sourceId: conversation.sourceId,
        fingerprint: conversation.fingerprint,
        title: conversation.title ?? "Untitled conversation",
        updatedAt: conversation.updatedAt,
        nodeCount: conversation.nodeCount,
        assetCount: conversation.assets.length,
        warnings: conversation.warnings,
      }
      pending.push({
        conversation,
        record,
        search: { sourceId: conversation.sourceId, searchText },
      })
      if (pending.length >= MAX_COLLECTION)
        count += await this.write(pending, progress)
    }
    count += await this.write(pending, progress)
    return count
  }

  private async write(
    pending: PendingRecord[],
    progress: (record: ImportRecord) => void
  ) {
    if (!pending.length) return 0
    const batch = pending.splice(0)
    await transaction(
      this.db,
      ["conversations", "records", "search"],
      "readwrite",
      async (tx) => {
        await Promise.all(
          batch.flatMap((row) => [
            request(tx.objectStore("conversations").put(row.conversation)),
            request(tx.objectStore("records").put(row.record)),
            request(tx.objectStore("search").put(row.search)),
          ])
        )
      }
    )
    for (const row of batch) progress(row.record)
    return batch.length
  }

  async records(filter: ImportFilter): Promise<ImportRecord[]> {
    const all = await transaction(this.db, "records", "readonly", (tx) =>
      request<ImportRecord[]>(tx.objectStore("records").getAll())
    )
    const query = filter.query.trim().toLocaleLowerCase()
    const searchById =
      filter.content && query
        ? new Map(
            (
              await transaction(this.db, "search", "readonly", (tx) =>
                request<StoredSearch[]>(tx.objectStore("search").getAll())
              )
            ).map((row) => [row.sourceId, row.searchText])
          )
        : null
    return all
      .filter((row) => {
        const corpus = filter.content
          ? `${row.title.toLocaleLowerCase()}\n${searchById?.get(row.sourceId) ?? ""}`
          : row.title.toLocaleLowerCase()
        return (
          (!query || corpus.includes(query)) &&
          (!filter.after ||
            row.updatedAt >=
              new Date(`${filter.after}T00:00:00`).toISOString()) &&
          (!filter.before ||
            row.updatedAt <=
              new Date(`${filter.before}T23:59:59.999`).toISOString()) &&
          (!filter.attachments || row.assetCount > 0)
        )
      })
      .sort((left, right) =>
        filter.order === "newest"
          ? right.updatedAt.localeCompare(left.updatedAt)
          : left.updatedAt.localeCompare(right.updatedAt)
      )
  }

  async conversation(id: string) {
    const row = await transaction(this.db, "conversations", "readonly", (tx) =>
      request<ImportConversation | undefined>(
        tx.objectStore("conversations").get(id)
      )
    )
    if (!row) throw new Error("Indexed conversation not found")
    return row
  }

  source(archive: ImportArchivePort): ImportSourcePort {
    return {
      conversation: (id) => this.conversation(id),
      asset: async (id) => {
        const name = this.format.assetEntry(archive, id)
        if (!name) return undefined
        if (archive.size(name) > MAX_FILE_ATTACHMENT_BYTES) {
          throw new Error("The file exceeds the 10 MiB attachment limit")
        }
        return readArchiveEntry(archive, name)
      },
    }
  }
}

function transaction<T>(
  db: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => Promise<T>
) {
  const tx = db.transaction(stores, mode)
  const complete = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  return Promise.all([run(tx), complete]).then(([result]) => result)
}

function request<T = undefined>(value: IDBRequest<T>) {
  return idb(value)
}

function idb<T>(value: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(value.error)
  })
}
