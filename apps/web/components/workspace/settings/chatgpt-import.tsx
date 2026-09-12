"use client"

import { useDeferredValue, useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useTRPC } from "@/lib/trpc-react"
import { MAX_COLLECTION } from "@/lib/limits"
import { openBrowserArchive } from "@/lib/imports/adapters/browser-archive"
import { chatgptFormat } from "@/lib/imports/adapters/chatgpt"
import { IndexedImportStore } from "@/lib/imports/adapters/indexed-db"
import { createTrpcImportTransport } from "@/lib/imports/adapters/trpc-client"
import {
  emptyImportFilter,
  type ImportArchivePort,
  type ImportFilter,
  type ImportRecord,
} from "@/lib/imports/model"
import { ImportPaused, runImportConversation } from "@/lib/imports/runner"

type Counts = {
  imported: number
  skipped: number
  changed: number
  failed: number
}
type ImportFailure = { sourceId: string; title: string; reason: string }

export function ChatgptImportSettings() {
  const inputRef = useRef<HTMLInputElement>(null),
    listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const storeRef = useRef<IndexedImportStore | null>(null),
    archiveRef = useRef<ImportArchivePort | null>(null)
  const trpc = useTRPC(),
    queryClient = useQueryClient()
  const [records, setRecords] = useState<ImportRecord[]>([]),
    [selected, setSelected] = useState<Set<string>>(new Set())
  const [visible, setVisible] = useState<ImportRecord[]>([])
  const [filter, setFilter] = useState<ImportFilter>(emptyImportFilter),
    deferredFilter = useDeferredValue(filter)
  const [indexing, setIndexing] = useState(false),
    [running, setRunning] = useState(false)
  const [indexedCount, setIndexedCount] = useState(0),
    [processed, setProcessed] = useState(0)
  const [result, setResult] = useState<Counts | null>(null)
  const [failures, setFailures] = useState<ImportFailure[]>([])
  const createSpace = useMutation(
    trpc.workspace.getOrCreateImportSpace.mutationOptions()
  )
  const begin = useMutation(trpc.workspace.beginImport.mutationOptions())
  const chunk = useMutation(trpc.workspace.appendImportAsset.mutationOptions())
  const finish = useMutation(trpc.workspace.finishImportAsset.mutationOptions())
  const omit = useMutation(trpc.workspace.omitImportAsset.mutationOptions())
  const nodes = useMutation(trpc.workspace.appendImportNodes.mutationOptions())
  const publish = useMutation(trpc.workspace.publishImport.mutationOptions())
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 48,
    overscan: 10,
  })

  useEffect(() => {
    const store = storeRef.current
    if (!store || indexing) return
    let cancelled = false
    void store.records(deferredFilter).then((matching) => {
      if (!cancelled) setVisible(matching)
    })
    return () => {
      cancelled = true
    }
  }, [deferredFilter, indexing, records])

  async function choose(file: File) {
    setIndexing(true)
    setIndexedCount(0)
    setRecords([])
    setVisible([])
    setResult(null)
    setFailures([])
    try {
      const archive = await openBrowserArchive(file),
        store = await IndexedImportStore.open(chatgptFormat)
      archiveRef.current = archive
      storeRef.current = store
      let count = 0
      await store.index(archive, () => {
        count++
        if (count === 1 || count % MAX_COLLECTION === 0) setIndexedCount(count)
      })
      const ordered = await store.records(emptyImportFilter)
      setRecords(ordered)
      setVisible(ordered)
      setSelected(restoreSelection(ordered))
      setIndexedCount(ordered.length)
      toast.success(
        `Indexed ${ordered.length.toLocaleString()} ChatGPT conversations`
      )
    } catch (error) {
      toast.error(message(error, "Could not read the ChatGPT export"))
    } finally {
      setIndexing(false)
    }
  }

  function updateSelection(update: (next: Set<string>) => void) {
    setSelected((current) => {
      const next = new Set(current)
      update(next)
      persistSelection(next)
      return next
    })
  }

  async function importSelected() {
    const store = storeRef.current,
      archive = archiveRef.current
    if (!store || !archive || !selected.size) return
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setProcessed(0)
    setResult(null)
    setFailures([])
    const counts: Counts = { imported: 0, skipped: 0, changed: 0, failed: 0 }
    const failed: ImportFailure[] = []
    try {
      const space = await createSpace.mutateAsync({
        source: chatgptFormat.id,
        label: chatgptFormat.label,
      })
      const source = store.source(archive),
        queue = records.filter((record) => selected.has(record.sourceId))
      for (const record of queue) {
        if (controller.signal.aborted) break
        try {
          const transport = createTrpcImportTransport(
            chatgptFormat.id,
            chatgptFormat.version,
            space.id,
            {
              begin: (value) => begin.mutateAsync(value),
              assetStatus: (value) =>
                queryClient.fetchQuery(
                  trpc.workspace.importAssetStatus.queryOptions(value)
                ),
              assetChunk: (value) => chunk.mutateAsync(value),
              finishAsset: (value) => finish.mutateAsync(value),
              omitAsset: (value) => omit.mutateAsync(value),
              nodes: (value) => nodes.mutateAsync(value),
              publish: (value) => publish.mutateAsync(value),
            }
          )
          const outcome = await runImportConversation(
            record.sourceId,
            source,
            transport,
            controller.signal
          )
          counts[outcome.status]++
        } catch (error) {
          if (error instanceof ImportPaused) break
          counts.failed++
          failed.push({
            sourceId: record.sourceId,
            title: record.title,
            reason: message(error, "Import failed"),
          })
          setFailures([...failed])
        }
        setProcessed((value) => value + 1)
        setResult({ ...counts })
      }
      await queryClient.invalidateQueries(trpc.workspace.get.queryFilter())
      if (!controller.signal.aborted)
        toast.success(
          `Imported ${counts.imported} conversation${counts.imported === 1 ? "" : "s"}`
        )
    } finally {
      abortRef.current = null
      setRunning(false)
    }
  }

  const busy = indexing || running
  return (
    <Card>
      <CardHeader>
        <CardTitle>Import conversations</CardTitle>
        <CardDescription>
          ChatGPT exports are indexed in this browser. Selected conversations
          upload in resumable batches to a movable ChatGPT Imports space.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            Choose ChatGPT export
          </Button>
          {records.length ? (
            <Button
              onClick={() => void importSelected()}
              disabled={busy || !selected.size}
            >
              {running
                ? `Importing ${processed}/${selected.size}…`
                : `Import ${selected.size.toLocaleString()} selected`}
            </Button>
          ) : null}
          {running ? (
            <Button variant="outline" onClick={() => abortRef.current?.abort()}>
              Pause
            </Button>
          ) : null}
          <input
            ref={inputRef}
            type="file"
            accept="application/zip,.zip,application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void choose(file)
              event.target.value = ""
            }}
          />
        </div>
        {indexing ? (
          <p className="text-sm text-muted-foreground">
            Indexing… {indexedCount.toLocaleString()} conversations
          </p>
        ) : null}
        {records.length ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Input
                value={filter.query}
                onChange={(event) =>
                  setFilter({ ...filter, query: event.target.value })
                }
                placeholder={
                  filter.content
                    ? "Search titles and messages"
                    : "Search titles"
                }
                className="lg:col-span-2"
              />
              <Input
                type="date"
                value={filter.after}
                onChange={(event) =>
                  setFilter({ ...filter, after: event.target.value })
                }
                aria-label="Updated after"
              />
              <Input
                type="date"
                value={filter.before}
                onChange={(event) =>
                  setFilter({ ...filter, before: event.target.value })
                }
                aria-label="Updated before"
              />
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={filter.content}
                  onChange={(event) =>
                    setFilter({ ...filter, content: event.target.checked })
                  }
                />
                Search message content
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={filter.attachments}
                  onChange={(event) =>
                    setFilter({ ...filter, attachments: event.target.checked })
                  }
                />
                Has attachments
              </label>
              <select
                className="h-8 rounded-md border bg-background px-2"
                value={filter.order}
                onChange={(event) =>
                  setFilter({
                    ...filter,
                    order: event.target.value as ImportFilter["order"],
                  })
                }
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  updateSelection((next) =>
                    visible.forEach((item) => next.add(item.sourceId))
                  )
                }
              >
                Select matching
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  updateSelection((next) =>
                    visible.forEach((item) => next.delete(item.sourceId))
                  )
                }
              >
                Clear matching
              </Button>
              <span className="text-muted-foreground">
                {visible.length.toLocaleString()} matching
              </span>
            </div>
            <div
              ref={listRef}
              className="h-80 overflow-y-auto rounded-md border"
            >
              <div
                className="relative"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((row) => {
                  const record = visible[row.index]!
                  return (
                    <label
                      key={record.sourceId}
                      className="absolute flex w-full cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm"
                      style={{
                        height: row.size,
                        transform: `translateY(${row.start}px)`,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(record.sourceId)}
                        onChange={() =>
                          updateSelection((next) =>
                            next.has(record.sourceId)
                              ? next.delete(record.sourceId)
                              : next.add(record.sourceId)
                          )
                        }
                        disabled={running}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {record.title}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {record.nodeCount} messages · {record.assetCount}{" "}
                          attachments
                          {record.warnings.length
                            ? ` · ${record.warnings.length} warnings`
                            : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {new Date(record.updatedAt).toLocaleDateString()}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          </>
        ) : null}
        {result ? (
          <p className="text-sm text-muted-foreground">
            {result.imported} imported, {result.skipped} already imported,{" "}
            {result.changed} changed exports skipped, {result.failed} failed.
          </p>
        ) : null}
        {failures.length ? (
          <details className="rounded-md border p-3 text-sm">
            <summary className="cursor-pointer font-medium">
              Failed conversations ({failures.length})
            </summary>
            <ul className="mt-2 grid gap-2">
              {failures.map((failure) => (
                <li key={failure.sourceId}>
                  <span className="font-medium">{failure.title}</span>
                  <span className="block text-xs break-words text-muted-foreground">
                    {failure.reason}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  )
}

function persistSelection(selected: Set<string>) {
  try {
    localStorage.setItem(
      "nibchat.import.chatgpt.selection",
      JSON.stringify([...selected])
    )
  } catch {
    /* localStorage can be unavailable or full */
  }
}
function restoreSelection(records: ImportRecord[]) {
  try {
    const saved = new Set<string>(
      JSON.parse(
        localStorage.getItem("nibchat.import.chatgpt.selection") ?? "[]"
      )
    )
    return saved.size
      ? new Set(
          records.flatMap((record) =>
            saved.has(record.sourceId) ? [record.sourceId] : []
          )
        )
      : new Set(records.map((record) => record.sourceId))
  } catch {
    return new Set(records.map((record) => record.sourceId))
  }
}
function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}
