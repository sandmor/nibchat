"use client"

import { MAX_COLLECTION, MAX_FILE_ATTACHMENT_BYTES } from "@/lib/limits"
import { readArchiveEntry } from "@/lib/imports/adapters/browser-archive"
import {
  type ImportArchivePort,
  type ImportConversation,
  type ImportFilter,
  type ImportFormatPort,
  type ImportEntity,
  type ImportRecord,
  type ImportSourcePort,
} from "@/lib/imports/model"

type StoredSearch = { sourceId: string; searchText: string }
type StoredConversation = Omit<ImportConversation, "entity">
type PendingRecord = {
  conversation: ImportConversation
  record: ImportRecord
  search: StoredSearch
}

const STORES = ["conversations", "records", "search", "entities"] as const

export class IndexedImportStore {
  private constructor(
    private readonly db: IDBDatabase,
    private readonly format: ImportFormatPort
  ) {}

  static async open(format: ImportFormatPort) {
    const name = `nibchat-import-${format.id}`
    try {
      const db = await openDatabase(name, format.version)
      if (STORES.every((store) => db.objectStoreNames.contains(store)))
        return new IndexedImportStore(db, format)
      db.close()
    } catch {
      /* Cached schema from a higher version or a partial upgrade. */
    }
    await deleteDatabase(name)
    return new IndexedImportStore(
      await openDatabase(name, format.version),
      format
    )
  }

  close() {
    this.db.close()
  }

  async index(
    archive: ImportArchivePort,
    progress: (record: ImportRecord) => void
  ) {
    await transaction(this.db, [...STORES], "readwrite", async (tx) => {
      await Promise.all([
        request(tx.objectStore("conversations").clear()),
        request(tx.objectStore("records").clear()),
        request(tx.objectStore("search").clear()),
        request(tx.objectStore("entities").clear()),
      ])
    })
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
        sourceAliases: conversation.sourceAliases ?? [],
        title: conversation.title ?? "Untitled conversation",
        updatedAt: conversation.updatedAt,
        nodeCount: conversation.nodeCount,
        assetCount: conversation.assets.length,
        warnings: conversation.warnings,
        entityId: conversation.entity?.id ?? null,
        entityLabel: conversation.entity?.label ?? null,
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
    if (this.format.entities) {
      const extras: ImportEntity[] = []
      for await (const entity of this.format.entities(archive))
        extras.push(entity)
      for (let offset = 0; offset < extras.length; offset += MAX_COLLECTION) {
        const batch = extras.slice(offset, offset + MAX_COLLECTION)
        await transaction(this.db, ["entities"], "readwrite", async (tx) => {
          await Promise.all(
            batch.map((entity) =>
              request(tx.objectStore("entities").put(entity))
            )
          )
        })
      }
    }
    return count
  }

  private async write(
    pending: PendingRecord[],
    progress: (record: ImportRecord) => void
  ) {
    if (!pending.length) return 0
    const batch = pending.splice(0)
    await transaction(this.db, [...STORES], "readwrite", async (tx) => {
      await Promise.all(
        batch.flatMap((row) => {
          const { entity, ...conversation } = row.conversation
          return [
            request(tx.objectStore("conversations").put(conversation)),
            request(tx.objectStore("records").put(row.record)),
            request(tx.objectStore("search").put(row.search)),
            ...(entity
              ? [request(tx.objectStore("entities").put(entity))]
              : []),
          ]
        })
      )
    })
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
          ? `${row.title.toLocaleLowerCase()}\n${(row.entityLabel ?? "").toLocaleLowerCase()}\n${searchById?.get(row.sourceId) ?? ""}`
          : `${row.title.toLocaleLowerCase()}\n${(row.entityLabel ?? "").toLocaleLowerCase()}`
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
      request<StoredConversation | undefined>(
        tx.objectStore("conversations").get(id)
      )
    )
    if (!row) throw new Error("Indexed conversation not found")
    return row
  }

  async entities(): Promise<ImportEntity[]> {
    const entities = await transaction(this.db, "entities", "readonly", (tx) =>
      request<ImportEntity[]>(tx.objectStore("entities").getAll())
    )
    return entities.sort((left, right) => left.label.localeCompare(right.label))
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

function openDatabase(name: string, version: number) {
  const request = indexedDB.open(name, version)
  request.onupgradeneeded = () => {
    for (const store of STORES) {
      if (request.result.objectStoreNames.contains(store))
        request.result.deleteObjectStore(store)
      request.result.createObjectStore(store, {
        keyPath: store === "entities" ? "id" : "sourceId",
      })
    }
  }
  return idb<IDBDatabase>(request)
}

function deleteDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => resolve()
  })
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
