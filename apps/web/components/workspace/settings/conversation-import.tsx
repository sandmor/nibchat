"use client"

import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import {
  clearMatchingChats,
  clearMatchingEntities,
  countSelected,
  selectMatchingChats,
  selectMatchingEntities,
  type ImportMatchingSelection,
} from "./conversation-import-selection"
import { useTRPC } from "@/lib/trpc-react"
import { MAX_COLLECTION } from "@/lib/limits"
import { openBrowserArchive } from "@/lib/imports/adapters/browser-archive"
import { chatgptFormat } from "@/lib/imports/adapters/chatgpt"
import { sillyTavernFormat } from "@/lib/imports/adapters/silly-tavern"
import { IndexedImportStore } from "@/lib/imports/adapters/indexed-db"
import { createTrpcImportTransport } from "@/lib/imports/adapters/trpc-client"
import {
  emptyImportFilter,
  type ImportArchivePort,
  type ImportFilter,
  type ImportRecord,
  type ImportEntity,
  type ImportFormatPort,
} from "@/lib/imports/model"
import { ImportPaused, runImportConversation } from "@/lib/imports/runner"

type Counts = {
  imported: number
  skipped: number
  changed: number
  omitted: number
  failed: number
}
type ImportFailure = { sourceId: string; title: string; reason: string }
type SpaceOption = { id: string; name: string }
type EntityDestination = {
  mode: "managed" | "existing" | "root" | "skip"
  destinationSpaceId?: string
  override?: boolean
}
type GroupedRow =
  | {
      type: "entity"
      entity: ImportEntity
      chatCount: number
      visibleChats: ImportRecord[]
    }
  | { type: "chat"; record: ImportRecord }
type ImportPlan = {
  chats: ImportRecord[]
  entityIds: string[]
  characterOnly: string[]
  omitted: number
}

const FORMATS = [chatgptFormat, sillyTavernFormat]
const ORDER_ITEMS = {
  newest: "Newest first",
  oldest: "Oldest first",
} as const

export function ConversationImportSettings() {
  const inputRef = useRef<HTMLInputElement>(null),
    listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const storeRef = useRef<IndexedImportStore | null>(null),
    archiveRef = useRef<ImportArchivePort | null>(null)
  const trpc = useTRPC(),
    queryClient = useQueryClient()
  const [records, setRecords] = useState<ImportRecord[]>([]),
    [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedEntities, setSelectedEntities] = useState<Set<string>>(
    new Set()
  )
  const [visible, setVisible] = useState<ImportRecord[]>([])
  const [filter, setFilter] = useState<ImportFilter>(emptyImportFilter),
    deferredFilter = useDeferredValue(filter)
  const [indexing, setIndexing] = useState(false),
    [running, setRunning] = useState(false)
  const [indexedCount, setIndexedCount] = useState(0),
    [processed, setProcessed] = useState(0)
  const [result, setResult] = useState<Counts | null>(null)
  const [failures, setFailures] = useState<ImportFailure[]>([])
  const [warningRecord, setWarningRecord] = useState<ImportRecord | null>(null)
  const [format, setFormat] = useState<ImportFormatPort>(chatgptFormat)
  const [entities, setEntities] = useState<ImportEntity[]>([])
  const [bulkEntityDestination, setBulkEntityDestination] = useState("managed")
  const [root, setRoot] = useState("managed")
  const [entityDestinations, setEntityDestinations] = useState<
    Record<string, EntityDestination>
  >({})
  const workspace = useQuery(trpc.workspace.get.queryOptions())
  const importSpaceMappings = useQuery(
    trpc.workspace.importSpaceMappings.queryOptions({ source: format.id })
  )
  const createSpace = useMutation(
    trpc.workspace.getOrCreateImportSpace.mutationOptions()
  )
  const resolveSpace = useMutation(
    trpc.workspace.resolveImportSpace.mutationOptions()
  )
  const begin = useMutation(trpc.workspace.beginImport.mutationOptions())
  const chunk = useMutation(trpc.workspace.appendImportAsset.mutationOptions())
  const finish = useMutation(trpc.workspace.finishImportAsset.mutationOptions())
  const omit = useMutation(trpc.workspace.omitImportAsset.mutationOptions())
  const nodes = useMutation(trpc.workspace.appendImportNodes.mutationOptions())
  const publish = useMutation(trpc.workspace.publishImport.mutationOptions())
  const grouped = format.id === "sillytavern"
  const groupedRows = grouped
    ? groupImportRows(entities, visible, records, filter.query)
    : []
  const virtualizer = useVirtualizer({
    count: grouped ? groupedRows.length : visible.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => {
      if (!grouped) return 56
      const item = groupedRows[index]
      if (item?.type === "entity" && item.visibleChats.length) return 104
      if (item?.type === "entity") return 72
      return 48
    },
    overscan: 10,
  })
  const visibleEntities = groupedRows.flatMap((row) =>
    row.type === "entity" ? [row.entity] : []
  )
  const visibleEntityIds = visibleEntities.map((entity) => entity.id)
  const selectedVisibleChats = countSelected(
    visible.map((record) => record.sourceId),
    selected
  )
  const selectedVisibleEntities = countSelected(
    visibleEntityIds,
    selectedEntities
  )
  const matchingSelection = (): ImportMatchingSelection => ({
    chats: selected,
    entities: selectedEntities,
  })
  const savedDestination = (entity: ImportEntity) =>
    importSpaceMappings.data?.find((mapping) =>
      [entity.id, ...(entity.aliases ?? [])].includes(mapping.entityId)
    )
  const plan = importPlan(
    records,
    selected,
    selectedEntities,
    entityDestinations
  )

  function setDestination(entityId: string, value: string) {
    setEntityDestinations((current) => ({
      ...current,
      [entityId]: value.startsWith("existing:")
        ? {
            mode: "existing",
            destinationSpaceId: value.slice("existing:".length),
            override: true,
          }
        : {
            mode: value as "managed" | "root" | "skip",
            override: true,
          },
    }))
  }

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

  async function choose(files: File[]) {
    setIndexing(true)
    setIndexedCount(0)
    setRecords([])
    setVisible([])
    setSelected(new Set())
    setSelectedEntities(new Set())
    setEntities([])
    setResult(null)
    setFailures([])
    storeRef.current?.close()
    storeRef.current = null
    archiveRef.current = null
    try {
      const archive = await openBrowserArchive(files),
        store = await IndexedImportStore.open(format)
      archiveRef.current = archive
      storeRef.current = store
      let count = 0
      await store.index(archive, () => {
        count++
        if (count === 1 || count % MAX_COLLECTION === 0) setIndexedCount(count)
      })
      const ordered = await store.records(emptyImportFilter)
      const detected = await store.entities()
      const chats = restoreSelection(
        ordered,
        format.id,
        format.id !== "sillytavern"
      )
      const entityIds = restoreEntitySelection(detected, format.id)
      for (const record of ordered)
        if (chats.has(record.sourceId) && record.entityId)
          entityIds.add(record.entityId)
      setRecords(ordered)
      setVisible(ordered)
      setSelected(chats)
      setSelectedEntities(entityIds)
      setEntities(detected)
      setEntityDestinations(
        Object.fromEntries(
          detected.map((entity) => [entity.id, { mode: "managed" as const }])
        )
      )
      setIndexedCount(ordered.length || detected.length)
      toast.success(
        indexedMessage(ordered.length, detected.length, format.label)
      )
    } catch (error) {
      toast.error(message(error, "Could not read the import files"))
    } finally {
      setIndexing(false)
    }
  }

  function commitSelection(next: ImportMatchingSelection) {
    persistSelection(next.chats, format.id)
    persistEntitySelection(next.entities, format.id)
    setSelected(next.chats)
    setSelectedEntities(next.entities)
  }

  function setChatSelected(sourceId: string, checked: boolean) {
    const record = records.find((item) => item.sourceId === sourceId)
    const chats = new Set(selected)
    const entities = new Set(selectedEntities)
    if (checked) {
      chats.add(sourceId)
      if (record?.entityId) entities.add(record.entityId)
    } else chats.delete(sourceId)
    commitSelection({ chats, entities })
  }

  function setEntitySelected(entityId: string, checked: boolean) {
    commitSelection(
      checked
        ? selectMatchingEntities(matchingSelection(), [entityId])
        : clearMatchingEntities(matchingSelection(), [entityId], records)
    )
  }

  function selectFormat(next: ImportFormatPort) {
    storeRef.current?.close()
    setFormat(next)
    setRecords([])
    setVisible([])
    setSelected(new Set())
    setSelectedEntities(new Set())
    setEntities([])
    setEntityDestinations({})
    storeRef.current = null
    archiveRef.current = null
  }

  async function importSelected() {
    const store = storeRef.current,
      archive = archiveRef.current
    const nextPlan = importPlan(
      records,
      selected,
      selectedEntities,
      entityDestinations
    )
    if (
      !store ||
      !archive ||
      (!nextPlan.chats.length && !nextPlan.entityIds.length)
    )
      return
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setProcessed(0)
    setResult(null)
    setFailures([])
    const counts: Counts = {
      imported: 0,
      skipped: 0,
      changed: 0,
      omitted: 0,
      failed: 0,
    }
    const failed: ImportFailure[] = []
    try {
      const source = store.source(archive)
      const inspections = new Map<string, "new" | "skipped" | "changed">()
      for (
        let offset = 0;
        offset < nextPlan.chats.length;
        offset += MAX_COLLECTION
      ) {
        const batch = nextPlan.chats.slice(offset, offset + MAX_COLLECTION)
        for (const item of await queryClient.fetchQuery(
          trpc.workspace.inspectImports.queryOptions({
            source: format.id,
            conversations: batch.map((record) => ({
              sourceId: record.sourceId,
              sourceAliases: record.sourceAliases,
              fingerprint: record.fingerprint,
            })),
          })
        ))
          inspections.set(item.sourceId, item.status)
      }
      let space: { id: string } | undefined
      const rootSpace = async () => {
        if (space) return space
        space =
          root === "managed"
            ? await createSpace.mutateAsync({
                source: format.id,
                label: format.label,
              })
            : { id: root }
        return space
      }
      const entityById = new Map(entities.map((entity) => [entity.id, entity]))
      const resolvedSpaces = new Map<string, string>()
      const resolveEntity = async (entityId: string) => {
        const cached = resolvedSpaces.get(entityId)
        if (cached) return cached
        const entity = entityById.get(entityId)
        if (!entity) throw new Error("Indexed entity metadata is unavailable")
        const destination = entityDestinations[entityId] ?? {
          mode: "managed" as const,
        }
        if (destination.mode === "skip")
          throw new Error("Skipped character cannot be imported")
        const resolved = await resolveSpace.mutateAsync({
          source: format.id,
          entity,
          mode: destination.mode,
          rootSpaceId: (await rootSpace()).id,
          ...(destination.destinationSpaceId
            ? { destinationSpaceId: destination.destinationSpaceId }
            : {}),
          ...(destination.override ? { override: true } : {}),
        })
        resolvedSpaces.set(entityId, resolved.id)
        return resolved.id
      }
      for (const entityId of nextPlan.entityIds) {
        if (controller.signal.aborted) break
        try {
          await resolveEntity(entityId)
        } catch (error) {
          if (error instanceof ImportPaused) break
          counts.failed++
          failed.push({
            sourceId: entityId,
            title: entityById.get(entityId)?.label ?? entityId,
            reason: message(error, "Import failed"),
          })
          setFailures([...failed])
        } finally {
          if (!nextPlan.chats.length) {
            setProcessed((value) => value + 1)
            setResult({ ...counts })
          }
        }
      }
      for (const record of nextPlan.chats) {
        if (controller.signal.aborted) break
        try {
          const prior = inspections.get(record.sourceId)
          if (prior && prior !== "new") {
            counts[prior]++
            continue
          }
          const destinationId = record.entityId
            ? await resolveEntity(record.entityId)
            : (await rootSpace()).id
          const transport = createTrpcImportTransport(
            format.id,
            format.version,
            destinationId,
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
        } finally {
          setProcessed((value) => value + 1)
          setResult({ ...counts })
        }
      }
      counts.omitted += nextPlan.omitted
      setResult({ ...counts })
      await queryClient.invalidateQueries(trpc.workspace.get.queryFilter())
      if (!controller.signal.aborted)
        toast.success(
          importedMessage(counts.imported, nextPlan.characterOnly.length)
        )
    } finally {
      abortRef.current = null
      setRunning(false)
    }
  }

  const busy = indexing || running
  const spaces = workspace.data?.spaces ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {grouped ? "Import from SillyTavern" : "Import conversations"}
        </CardTitle>
        <CardDescription>
          {grouped
            ? "Character cards become spaces. Select matching characters and chats separately. Importing a chat includes its character; you can import a character with no chats."
            : "Exports are indexed in this browser. Selected conversations upload in resumable batches, without sending the export itself to the server."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <ToggleGroup
            value={[format.id]}
            onValueChange={(next) => {
              const found = FORMATS.find((item) => item.id === next[0])
              if (found && found.id !== format.id) selectFormat(found)
            }}
            disabled={busy}
            variant="outline"
            spacing={0}
            size="sm"
            aria-label="Import format"
          >
            {FORMATS.map((item) => (
              <ToggleGroupItem key={item.id} value={item.id}>
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              Choose {format.label} export
            </Button>
            {(records.length || entities.length) && !indexing ? (
              <Button
                onClick={() => void importSelected()}
                disabled={
                  busy || (!plan.chats.length && !plan.entityIds.length)
                }
              >
                {running
                  ? `Importing ${processed}/${plan.chats.length || plan.entityIds.length}…`
                  : importButtonLabel(plan)}
              </Button>
            ) : null}
            {running ? (
              <Button
                variant="outline"
                onClick={() => abortRef.current?.abort()}
              >
                Pause
              </Button>
            ) : null}
            <input
              ref={inputRef}
              type="file"
              accept={
                format.id === "sillytavern"
                  ? "application/zip,.zip,application/jsonl,.jsonl,image/png,.png"
                  : "application/zip,.zip,application/json,.json"
              }
              multiple={format.id === "sillytavern"}
              className="hidden"
              onChange={(event) => {
                const files = event.target.files
                if (files?.length) void choose([...files])
                event.target.value = ""
              }}
            />
          </div>
        </div>
        {indexing ? (
          <p className="text-sm text-muted-foreground">
            Indexing… {indexedCount.toLocaleString()}
            {grouped ? " items" : " conversations"}
          </p>
        ) : null}
        {records.length || entities.length ? (
          <>
            <div className="flex flex-col gap-3 rounded-xl bg-muted/40 p-3 ring-1 ring-foreground/8">
              <div className="grid gap-1.5">
                <Label htmlFor="import-root">Import root</Label>
                <Select
                  value={root}
                  items={rootItems(format.label, spaces)}
                  disabled={busy}
                  onValueChange={(value) => value && setRoot(value)}
                >
                  <SelectTrigger id="import-root" className="w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="managed">
                      Create or reuse {format.label} Imports
                    </SelectItem>
                    {spaces.map((space) => (
                      <SelectItem key={space.id} value={space.id}>
                        {space.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-3 rounded-xl bg-muted/40 p-3 ring-1 ring-foreground/8">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Input
                  value={filter.query}
                  onChange={(event) =>
                    setFilter({ ...filter, query: event.target.value })
                  }
                  placeholder={
                    grouped
                      ? filter.content
                        ? "Search characters, titles, and messages"
                        : "Search characters and titles"
                      : filter.content
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
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id="import-search-content"
                    size="sm"
                    checked={filter.content}
                    onCheckedChange={(content) =>
                      setFilter({ ...filter, content })
                    }
                  />
                  <Label
                    htmlFor="import-search-content"
                    className="font-normal"
                  >
                    Search message content
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="import-has-attachments"
                    size="sm"
                    checked={filter.attachments}
                    onCheckedChange={(attachments) =>
                      setFilter({ ...filter, attachments })
                    }
                  />
                  <Label
                    htmlFor="import-has-attachments"
                    className="font-normal"
                  >
                    Has attachments
                  </Label>
                </div>
                <Select
                  value={filter.order}
                  items={ORDER_ITEMS}
                  onValueChange={(value) => {
                    if (value === "newest" || value === "oldest")
                      setFilter({ ...filter, order: value })
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="min-w-[9rem]"
                    aria-label="Sort order"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest first</SelectItem>
                    <SelectItem value="oldest">Oldest first</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {grouped ? (
                <div className="grid gap-3 border-t border-border pt-3">
                  <MatchingScopeBar
                    label="Characters"
                    selected={selectedVisibleEntities}
                    matching={visibleEntities.length}
                    selectLabel="Select matching characters"
                    clearLabel="Clear matching characters"
                    disabled={busy}
                    onSelect={() =>
                      commitSelection(
                        selectMatchingEntities(
                          matchingSelection(),
                          visibleEntityIds
                        )
                      )
                    }
                    onClear={() =>
                      commitSelection(
                        clearMatchingEntities(
                          matchingSelection(),
                          visibleEntityIds,
                          records
                        )
                      )
                    }
                    extra={
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="min-w-[12rem] flex-1">
                          <DestinationSelect
                            value={bulkEntityDestination}
                            spaces={spaces}
                            disabled={busy || !visibleEntities.length}
                            size="sm"
                            ariaLabel="Bulk destination"
                            onChange={setBulkEntityDestination}
                          />
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy || !visibleEntities.length}
                          onClick={() => {
                            for (const entity of visibleEntities)
                              setDestination(entity.id, bulkEntityDestination)
                          }}
                        >
                          Apply to matching characters
                        </Button>
                      </div>
                    }
                  />
                  <Separator />
                  <MatchingScopeBar
                    label="Chats"
                    selected={selectedVisibleChats}
                    matching={visible.length}
                    selectLabel="Select matching chats"
                    clearLabel="Clear matching chats"
                    disabled={busy}
                    onSelect={() =>
                      commitSelection(
                        selectMatchingChats(matchingSelection(), visible)
                      )
                    }
                    onClear={() =>
                      commitSelection(
                        clearMatchingChats(matchingSelection(), visible)
                      )
                    }
                  />
                </div>
              ) : (
                <MatchingScopeBar
                  label="Conversations"
                  selected={selectedVisibleChats}
                  matching={visible.length}
                  selectLabel="Select matching"
                  clearLabel="Clear matching"
                  disabled={busy}
                  onSelect={() =>
                    commitSelection(
                      selectMatchingChats(matchingSelection(), visible)
                    )
                  }
                  onClear={() =>
                    commitSelection(
                      clearMatchingChats(matchingSelection(), visible)
                    )
                  }
                />
              )}
              <div
                ref={listRef}
                className="h-96 overflow-y-auto overscroll-contain rounded-lg bg-background/80 ring-1 ring-foreground/8"
              >
                {grouped ? (
                  groupedRows.length === 0 ? (
                    <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                      No characters or chats match this filter.
                    </p>
                  ) : (
                    <div
                      className="relative"
                      style={{ height: virtualizer.getTotalSize() }}
                    >
                      {virtualizer.getVirtualItems().map((row) => {
                        const item = groupedRows[row.index]!
                        if (item.type === "entity") {
                          const destination = entityDestinations[
                            item.entity.id
                          ] ?? { mode: "managed" as const }
                          const saved = savedDestination(item.entity)
                          const checked = selectedEntities.has(item.entity.id)
                          const selectedChatCount = countSelected(
                            item.visibleChats.map((record) => record.sourceId),
                            selected
                          )
                          return (
                            <div
                              key={item.entity.id}
                              data-index={row.index}
                              ref={virtualizer.measureElement}
                              className={cn(
                                "absolute top-0 left-0 grid w-full gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] sm:items-center",
                                checked && "bg-muted/40"
                              )}
                              style={{
                                transform: `translateY(${row.start}px)`,
                              }}
                            >
                              <label className="flex min-w-0 cursor-pointer items-center gap-3">
                                <input
                                  type="checkbox"
                                  className="peer sr-only"
                                  checked={checked}
                                  onChange={() =>
                                    setEntitySelected(item.entity.id, !checked)
                                  }
                                  disabled={running}
                                />
                                <SelectionMark checked={checked} />
                                <span className="min-w-0">
                                  <span className="flex min-w-0 items-center gap-2">
                                    <span className="truncate font-medium">
                                      {item.entity.label}
                                    </span>
                                    <Badge
                                      variant="outline"
                                      className="capitalize"
                                    >
                                      {item.entity.kind}
                                    </Badge>
                                  </span>
                                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                    {item.chatCount
                                      ? `${item.visibleChats.length.toLocaleString()} of ${item.chatCount.toLocaleString()} chats match this filter`
                                      : "No chats in this export"}
                                    {!destination.override && saved
                                      ? ` · Will reuse ${saved.spaceName}`
                                      : ""}
                                  </span>
                                </span>
                              </label>
                              <DestinationSelect
                                value={destinationValue(destination)}
                                spaces={spaces}
                                disabled={busy}
                                size="sm"
                                ariaLabel={`Destination for ${item.entity.label}`}
                                onChange={(value) =>
                                  setDestination(item.entity.id, value)
                                }
                              />
                              {item.visibleChats.length ? (
                                <div className="flex flex-wrap items-center gap-2 sm:col-span-2 sm:pl-7">
                                  <span className="text-xs text-muted-foreground">
                                    {selectedChatCount.toLocaleString()} of{" "}
                                    {item.visibleChats.length.toLocaleString()}{" "}
                                    matching chats selected
                                  </span>
                                  <Button
                                    type="button"
                                    size="xs"
                                    variant="outline"
                                    disabled={
                                      running ||
                                      selectedChatCount ===
                                        item.visibleChats.length
                                    }
                                    aria-label={`Select chats for ${item.entity.label}`}
                                    onClick={() =>
                                      commitSelection(
                                        selectMatchingChats(
                                          matchingSelection(),
                                          item.visibleChats
                                        )
                                      )
                                    }
                                  >
                                    Select chats
                                  </Button>
                                  <Button
                                    type="button"
                                    size="xs"
                                    variant="ghost"
                                    disabled={
                                      running || selectedChatCount === 0
                                    }
                                    aria-label={`Clear chats for ${item.entity.label}`}
                                    onClick={() =>
                                      commitSelection(
                                        clearMatchingChats(
                                          matchingSelection(),
                                          item.visibleChats
                                        )
                                      )
                                    }
                                  >
                                    Clear chats
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          )
                        }
                        const record = item.record
                        const checked = selected.has(record.sourceId)
                        return (
                          <div
                            key={record.sourceId}
                            data-index={row.index}
                            ref={virtualizer.measureElement}
                            className={cn(
                              "absolute top-0 left-0 flex w-full items-center gap-3 py-2 pr-3 pl-10 text-sm transition-colors hover:bg-muted/60",
                              checked && "bg-muted/50"
                            )}
                            style={{
                              transform: `translateY(${row.start}px)`,
                            }}
                          >
                            <ChatImportRow
                              record={record}
                              checked={checked}
                              running={running}
                              onToggle={() =>
                                setChatSelected(record.sourceId, !checked)
                              }
                              onWarnings={() => setWarningRecord(record)}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )
                ) : visible.length === 0 ? (
                  <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No conversations match this filter.
                  </p>
                ) : (
                  <div
                    className="relative"
                    style={{ height: virtualizer.getTotalSize() }}
                  >
                    {virtualizer.getVirtualItems().map((row) => {
                      const record = visible[row.index]!
                      const checked = selected.has(record.sourceId)
                      return (
                        <div
                          key={record.sourceId}
                          className={cn(
                            "absolute flex w-full items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted/60",
                            checked && "bg-muted/50"
                          )}
                          style={{
                            height: row.size,
                            transform: `translateY(${row.start}px)`,
                          }}
                        >
                          <ChatImportRow
                            record={record}
                            checked={checked}
                            running={running}
                            onToggle={() =>
                              setChatSelected(record.sourceId, !checked)
                            }
                            onWarnings={() => setWarningRecord(record)}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : null}
        {result ? (
          <p className="text-sm text-muted-foreground">
            {result.imported} imported, {result.skipped} already imported,{" "}
            {result.changed} changed exports skipped, {result.omitted} omitted,{" "}
            {result.failed} failed.
          </p>
        ) : null}
        {failures.length ? (
          <Collapsible
            defaultOpen
            className="group/failures overflow-hidden rounded-xl ring-1 ring-foreground/8"
          >
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50">
              Failed conversations ({failures.length})
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                strokeWidth={2}
                className="size-4 shrink-0 text-muted-foreground transition-transform group-data-open/failures:rotate-180"
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-border">
              <ul className="grid gap-2 p-3">
                {failures.map((failure) => (
                  <li key={failure.sourceId} className="text-sm">
                    <span className="font-medium">{failure.title}</span>
                    <span className="block text-xs break-words text-muted-foreground">
                      {failure.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
        <Dialog
          open={Boolean(warningRecord)}
          onOpenChange={(open) => {
            if (!open) setWarningRecord(null)
          }}
        >
          <DialogContent className="max-h-[70vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Import warnings</DialogTitle>
              <DialogDescription>{warningRecord?.title}</DialogDescription>
            </DialogHeader>
            <ul className="grid gap-2 text-sm">
              {warningRecord?.warnings.map((warning) => (
                <li
                  key={warning}
                  className="rounded-xl bg-muted/40 px-3 py-2 ring-1 ring-foreground/8"
                >
                  {warning}
                </li>
              ))}
            </ul>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

function rootItems(label: string, spaces: SpaceOption[]) {
  return {
    managed: `Create or reuse ${label} Imports`,
    ...Object.fromEntries(spaces.map((space) => [space.id, space.name])),
  }
}

function destinationItems(spaces: SpaceOption[]) {
  return {
    managed: "Create or reuse child space",
    root: "Use import root",
    skip: "Skip",
    ...Object.fromEntries(
      spaces.map((space) => [`existing:${space.id}`, `Use ${space.name}`])
    ),
  }
}

function destinationValue(destination: EntityDestination) {
  return destination.mode === "existing"
    ? `existing:${destination.destinationSpaceId ?? ""}`
    : destination.mode
}

function DestinationSelect({
  value,
  spaces,
  disabled,
  size = "default",
  ariaLabel,
  onChange,
}: {
  value: string
  spaces: SpaceOption[]
  disabled?: boolean
  size?: "sm" | "default"
  ariaLabel?: string
  onChange: (value: string) => void
}) {
  return (
    <Select
      value={value}
      items={destinationItems(spaces)}
      disabled={disabled}
      onValueChange={(next) => next && onChange(next)}
    >
      <SelectTrigger
        size={size}
        className="w-full min-w-0"
        aria-label={ariaLabel}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="managed">Create or reuse child space</SelectItem>
        <SelectItem value="root">Use import root</SelectItem>
        <SelectItem value="skip">Skip</SelectItem>
        {spaces.map((space) => (
          <SelectItem key={space.id} value={`existing:${space.id}`}>
            Use {space.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function MatchingScopeBar({
  label,
  selected,
  matching,
  selectLabel,
  clearLabel,
  disabled,
  onSelect,
  onClear,
  extra,
}: {
  label: string
  selected: number
  matching: number
  selectLabel: string
  clearLabel: string
  disabled?: boolean
  onSelect: () => void
  onClear: () => void
  extra?: ReactNode
}) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">
            {selected.toLocaleString()} of {matching.toLocaleString()} matching
            selected
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || matching === 0 || selected === matching}
            onClick={onSelect}
          >
            {selectLabel}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || selected === 0}
            onClick={onClear}
          >
            {clearLabel}
          </Button>
        </div>
      </div>
      {extra}
    </div>
  )
}

function SelectionMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors peer-focus-visible:border-ring peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input-border bg-input/30"
      )}
    >
      {checked ? (
        <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="size-2.5" />
      ) : null}
    </span>
  )
}

function ChatImportRow({
  record,
  checked,
  running,
  onToggle,
  onWarnings,
}: {
  record: ImportRecord
  checked: boolean
  running: boolean
  onToggle: () => void
  onWarnings: () => void
}) {
  return (
    <>
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={onToggle}
          disabled={running}
        />
        <SelectionMark checked={checked} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{record.title}</span>
          <span className="text-xs text-muted-foreground">
            {record.nodeCount} messages · {record.assetCount} attachments
            {record.entityLabel ? ` · ${record.entityLabel}` : ""}
          </span>
        </span>
      </label>
      {record.warnings.length ? (
        <Button type="button" variant="ghost" size="xs" onClick={onWarnings}>
          {record.warnings.length} warning
          {record.warnings.length === 1 ? "" : "s"}
        </Button>
      ) : null}
      <span className="shrink-0 text-xs text-muted-foreground">
        {new Date(record.updatedAt).toLocaleDateString()}
      </span>
    </>
  )
}

function groupImportRows(
  entities: ImportEntity[],
  visible: ImportRecord[],
  records: ImportRecord[],
  query: string
): GroupedRow[] {
  const chatsByEntity = new Map<string, ImportRecord[]>()
  const orphans: ImportRecord[] = []
  for (const record of visible) {
    if (record.entityId) {
      const list = chatsByEntity.get(record.entityId) ?? []
      list.push(record)
      chatsByEntity.set(record.entityId, list)
    } else orphans.push(record)
  }
  const totalByEntity = new Map<string, number>()
  for (const record of records) {
    if (!record.entityId) continue
    totalByEntity.set(
      record.entityId,
      (totalByEntity.get(record.entityId) ?? 0) + 1
    )
  }
  const q = query.trim().toLocaleLowerCase()
  const rows: GroupedRow[] = []
  for (const entity of entities) {
    const visibleChats = chatsByEntity.get(entity.id) ?? []
    const nameMatch = !q || entity.label.toLocaleLowerCase().includes(q)
    if (!nameMatch && !visibleChats.length) continue
    rows.push({
      type: "entity",
      entity,
      chatCount: totalByEntity.get(entity.id) ?? 0,
      visibleChats,
    })
    for (const record of visibleChats) rows.push({ type: "chat", record })
  }
  for (const record of orphans) rows.push({ type: "chat", record })
  return rows
}

function importPlan(
  records: ImportRecord[],
  selected: Set<string>,
  selectedEntities: Set<string>,
  destinations: Record<string, EntityDestination>
): ImportPlan {
  const skipped = new Set(
    [...selectedEntities].filter((id) => destinations[id]?.mode === "skip")
  )
  const selectedChats = records.filter((record) =>
    selected.has(record.sourceId)
  )
  const omitted = selectedChats.filter(
    (record) => record.entityId && skipped.has(record.entityId)
  ).length
  const chats = selectedChats.filter(
    (record) => !record.entityId || !skipped.has(record.entityId)
  )
  const entityIds = new Set<string>()
  for (const id of selectedEntities) if (!skipped.has(id)) entityIds.add(id)
  for (const record of chats)
    if (record.entityId) entityIds.add(record.entityId)
  const chatEntityIds = new Set(
    chats.flatMap((record) => (record.entityId ? [record.entityId] : []))
  )
  return {
    chats,
    entityIds: [...entityIds],
    characterOnly: [...entityIds].filter((id) => !chatEntityIds.has(id)),
    omitted,
  }
}

function indexedMessage(chats: number, entities: number, label: string) {
  if (chats && entities)
    return `Indexed ${chats.toLocaleString()} conversations and ${entities.toLocaleString()} characters`
  if (!chats && entities)
    return `Indexed ${entities.toLocaleString()} ${label} characters`
  return `Indexed ${chats.toLocaleString()} ${label} conversations`
}

function importedMessage(chats: number, characters: number) {
  const parts = [
    ...(chats
      ? [`${chats.toLocaleString()} conversation${chats === 1 ? "" : "s"}`]
      : []),
    ...(characters
      ? [
          `${characters.toLocaleString()} character${characters === 1 ? "" : "s"}`,
        ]
      : []),
  ]
  return parts.length ? `Imported ${parts.join(" and ")}` : "Nothing to import"
}

function importButtonLabel(plan: ImportPlan) {
  if (plan.chats.length && plan.characterOnly.length)
    return `Import ${plan.chats.length.toLocaleString()} chats and ${plan.characterOnly.length.toLocaleString()} characters`
  if (plan.characterOnly.length && !plan.chats.length)
    return `Import ${plan.characterOnly.length.toLocaleString()} character${plan.characterOnly.length === 1 ? "" : "s"}`
  return `Import ${plan.chats.length.toLocaleString()} selected`
}

function persistSelection(selected: Set<string>, source: string) {
  try {
    localStorage.setItem(
      `nibchat.import.${source}.selection`,
      JSON.stringify([...selected])
    )
  } catch {
    /* localStorage can be unavailable or full */
  }
}

function persistEntitySelection(selected: Set<string>, source: string) {
  try {
    localStorage.setItem(
      `nibchat.import.${source}.entities`,
      JSON.stringify([...selected])
    )
  } catch {
    /* localStorage can be unavailable or full */
  }
}

function restoreSelection(
  records: ImportRecord[],
  source: string,
  selectAllByDefault: boolean
): Set<string> {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(`nibchat.import.${source}.selection`) ?? "[]"
    )
    const saved = new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : []
    )
    if (saved.size)
      return new Set(
        records.flatMap((record) =>
          saved.has(record.sourceId) ? [record.sourceId] : []
        )
      )
    return selectAllByDefault
      ? new Set(records.map((record) => record.sourceId))
      : new Set()
  } catch {
    return selectAllByDefault
      ? new Set(records.map((record) => record.sourceId))
      : new Set()
  }
}

function restoreEntitySelection(
  entities: ImportEntity[],
  source: string
): Set<string> {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(`nibchat.import.${source}.entities`) ?? "[]"
    )
    const saved = new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : []
    )
    return new Set(
      entities.flatMap((entity) => (saved.has(entity.id) ? [entity.id] : []))
    )
  } catch {
    return new Set()
  }
}

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}
