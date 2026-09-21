"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, Delete02Icon } from "@hugeicons/core-free-icons"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import {
  createContextBookEntry,
  contextBookToJson,
  defaultContextBook,
  readContextBook,
  resolveContextEntries,
  type ContextBookDocument,
  type ContextBookEntry,
  type ContextEntryDecision,
} from "@/lib/context-books"
import { openBrowserArchive } from "@/lib/imports/adapters/browser-archive"
import {
  extractSillyTavernWorldInfo,
  importSillyTavernWorldInfo,
  looksLikeWorldInfo,
  sillyTavernBookEntityId,
} from "@/lib/imports/silly-tavern-world-info"
import { catalogMacroContext } from "@/lib/prompt-macros"
import { useTRPC } from "@/lib/trpc-react"
import { MacroPicker } from "./macro-picker"
import { ScanDepthField } from "../scan-depth-field"
import { useBrowserTimeZone } from "../hooks"

type Draft = { id: string; name: string; book: ContextBookDocument }

const SCAN_ROLE_ITEMS = {
  user: "User",
  assistant: "Assistant",
  both: "Both",
} as const

type ScanRoleChoice = keyof typeof SCAN_ROLE_ITEMS

function scanRoleChoice(
  roles: readonly ("user" | "assistant")[]
): ScanRoleChoice {
  const user = roles.includes("user")
  const assistant = roles.includes("assistant")
  if (user && assistant) return "both"
  if (assistant) return "assistant"
  return "user"
}

function scanRolesFromChoice(choice: ScanRoleChoice): ("user" | "assistant")[] {
  if (choice === "assistant") return ["assistant"]
  if (choice === "both") return ["user", "assistant"]
  return ["user"]
}

const STATUS_LABEL: Record<ContextEntryDecision["status"], string> = {
  included: "Included",
  unmatched: "Not triggered",
  disabled: "Off",
  budget: "Over budget",
  invalid: "Invalid",
}

function matchActivation(): Extract<
  ContextBookEntry["activation"],
  { kind: "match" }
> {
  return {
    kind: "match",
    keywords: [],
    match: "any",
    secondary: [],
    secondaryMatch: "any",
    caseSensitive: false,
    wholeWord: true,
  }
}

function triggerLabel(entry: ContextBookEntry) {
  if (entry.activation.kind === "always") return "Always"
  const count = entry.activation.keywords.length
  if (count === 0) return "No triggers"
  if (count === 1) return entry.activation.keywords[0] ?? "1 trigger"
  return `${count} triggers`
}

function lines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
}

function sameBook(left: ContextBookDocument, right: ContextBookDocument) {
  try {
    return contextBookToJson(left) === contextBookToJson(right)
  } catch {
    return false
  }
}

function TriggerListField({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string
  value: string[]
  placeholder: string
  onCommit: (value: string[]) => void
}) {
  const committed = value.join("\n")
  const [text, setText] = useState(committed)
  useEffect(() => {
    setText(committed)
  }, [committed])

  function emit(nextText: string, normalize: boolean) {
    const next = lines(nextText)
    const normalized = next.join("\n")
    if (normalize) setText(normalized)
    if (normalized === committed) return
    onCommit(next)
  }

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Textarea
        rows={4}
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          const nextText = event.target.value
          setText(nextText)
          emit(nextText, false)
        }}
        onBlur={() => emit(text, true)}
        className="field-sizing-fixed min-h-24"
      />
    </div>
  )
}

export function ContextBookSettings() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const query = useQuery(trpc.workspace.getSettings.queryOptions())
  const books = query.data?.contextBooks ?? []
  const loaded = query.isSuccess
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected =
    books.find((book) => book.id === selectedId) ?? books[0] ?? null
  const [draft, setDraft] = useState<Draft | null>(null)
  const active = draft && selected && draft.id === selected.id ? draft : null
  const name = active?.name ?? selected?.name ?? ""
  const book = active?.book ?? selected?.book ?? defaultContextBook()
  const [testText, setTestText] = useState("")
  const [openEntryId, setOpenEntryId] = useState<string | null>(null)
  const [deleteBook, setDeleteBook] = useState<{
    id: string
    name: string
  } | null>(null)
  const dirty = Boolean(
    selected &&
    active &&
    (active.name !== selected.name || !sameBook(active.book, selected.book))
  )

  const refresh = async () => {
    await Promise.all([
      query.refetch(),
      queryClient.invalidateQueries(trpc.workspace.get.queryFilter()),
    ])
  }

  function withDraft(recipe: (current: Draft) => Draft) {
    const selectedBook = selected
    setDraft((current) => {
      const base =
        current?.id === selectedBook?.id
          ? current
          : selectedBook
            ? {
                id: selectedBook.id,
                name: selectedBook.name,
                book: structuredClone(selectedBook.book),
              }
            : null
      if (!base) return current
      return recipe(base)
    })
  }

  function patchBook(patch: Partial<ContextBookDocument>) {
    withDraft((current) => ({
      ...current,
      book: { ...current.book, ...patch },
    }))
  }

  function patchEntry(entryId: string, patch: Partial<ContextBookEntry>) {
    withDraft((current) => ({
      ...current,
      book: {
        ...current.book,
        entries: current.book.entries.map((entry) =>
          entry.id === entryId
            ? ({ ...entry, ...patch } as ContextBookEntry)
            : entry
        ),
      },
    }))
  }

  const create = useMutation(
    trpc.workspace.createContextBook.mutationOptions({
      onSuccess: async (created) => {
        await refresh()
        setSelectedId(created.id)
        setDraft(null)
        toast.success("Context book created")
      },
      onError: (error) => toast.error(error.message),
    })
  )
  const resolveImported = useMutation(
    trpc.workspace.resolveImportBook.mutationOptions({
      onError: (error) => toast.error(error.message),
    })
  )
  const update = useMutation(
    trpc.workspace.updateContextBook.mutationOptions({
      onSuccess: async () => {
        await refresh()
        setDraft(null)
        toast.success("Context book saved")
      },
      onError: (error) => toast.error(error.message),
    })
  )
  const duplicate = useMutation(
    trpc.workspace.duplicateContextBook.mutationOptions({
      onSuccess: async (created) => {
        await refresh()
        setSelectedId(created.id)
        setDraft(null)
      },
      onError: (error) => toast.error(error.message),
    })
  )
  const remove = useMutation(
    trpc.workspace.deleteContextBook.mutationOptions({
      onSuccess: async () => {
        setSelectedId(null)
        setDraft(null)
        setDeleteBook(null)
        await refresh()
        toast.success("Context book deleted")
      },
      onError: (error) => toast.error(error.message),
    })
  )

  const testByEntry = useMemo(() => {
    if (!selected || !testText.trim())
      return new Map<string, ContextEntryDecision>()
    return new Map(
      resolveContextEntries({
        books: [
          {
            id: selected.id,
            name,
            book,
            source: "chat",
          },
        ],
        messages: [{ role: "user", text: testText }],
      }).decisions.map((decision) => [decision.entryId, decision])
    )
  }, [book, name, selected, testText])

  async function importSillyTavernBook(
    name: string,
    book: ContextBookDocument,
    sourcePath: string
  ) {
    const resolved = await resolveImported.mutateAsync({
      source: "sillytavern",
      entityId: sillyTavernBookEntityId(sourcePath),
      name,
      book,
    })
    await refresh()
    setSelectedId(resolved.id)
    setDraft(null)
    toast.success(
      resolved.created
        ? "Context book created"
        : resolved.replaced
          ? "Context book replaced"
          : resolved.changed
            ? "A newer export was skipped to keep local edits"
            : "Context book already imported"
    )
  }

  async function importFile(file: File) {
    try {
      const lower = file.name.toLowerCase()
      const fallbackName = file.name.replace(/\.(json|png|zip)$/i, "")
      if (lower.endsWith(".json")) {
        const raw = JSON.parse(await file.text())
        let native: ContextBookDocument | undefined
        try {
          native = readContextBook(raw)
        } catch {
          native = undefined
        }
        if (native) {
          await create.mutateAsync({ name: fallbackName, book: native })
          return
        }
        if (looksLikeWorldInfo(raw)) {
          const converted = importSillyTavernWorldInfo(raw)
          if (converted.issues.length)
            toast.warning(
              `${converted.issues.length} entries need review and were disabled`
            )
          await importSillyTavernBook(
            converted.name ?? fallbackName,
            converted.book,
            file.name
          )
          return
        }
      }
      const found = await extractSillyTavernWorldInfo(
        await openBrowserArchive(file)
      )
      if (!found.length) throw new Error("No SillyTavern world info was found")
      for (const item of found) {
        if (item.issues.length)
          toast.warning(
            `${item.name ?? item.source}: ${item.issues.length} entries need review and were disabled`
          )
        await importSillyTavernBook(
          item.name ??
            item.source
              .split("/")
              .at(-1)
              ?.replace(/\.(json|png)$/i, "") ??
            fallbackName,
          item.book,
          item.source
        )
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not import book"
      )
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Context books</CardTitle>
        <CardDescription>
          Keyword-triggered notes inserted with{" "}
          <code>{"{{contextEntries}}"}</code>. Attach a book to a space or chat;
          matching entries join the prompt at send time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-2">
          {selected ? (
            <Select
              value={selected.id}
              items={Object.fromEntries(
                books.map((item) => [item.id, item.name])
              )}
              onValueChange={(id) => {
                if (id == null) return
                setSelectedId(String(id))
                setDraft(null)
              }}
              disabled={!loaded || books.length === 0}
            >
              <SelectTrigger
                className="w-full min-w-0 sm:w-auto sm:min-w-[12rem]"
                aria-label="Selected context book"
              >
                <SelectValue placeholder="Select a book" />
              </SelectTrigger>
              <SelectContent>
                {books.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full min-w-0 justify-start rounded-4xl sm:w-auto sm:min-w-[12rem]"
              disabled
            >
              {loaded ? "No books" : "Loading…"}
            </Button>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!loaded || create.isPending}
              onClick={() =>
                create.mutate({
                  name: "New context book",
                  book: defaultContextBook(),
                })
              }
            >
              New
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              Import
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json,image/png,.png,application/zip,.zip"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void importFile(file)
                event.target.value = ""
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!selected || duplicate.isPending}
              onClick={() => selected && duplicate.mutate({ id: selected.id })}
            >
              Duplicate
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!selected}
              onClick={() => {
                if (!selected) return
                const blob = new Blob([JSON.stringify(book, null, 2)], {
                  type: "application/json",
                })
                const url = URL.createObjectURL(blob)
                const anchor = document.createElement("a")
                anchor.href = url
                anchor.download = `${
                  name.replace(/[^a-z0-9._-]+/gi, "-") || "context-book"
                }.json`
                anchor.click()
                URL.revokeObjectURL(url)
              }}
            >
              Export
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!selected || remove.isPending}
              onClick={() => {
                if (!selected) return
                setDeleteBook({ id: selected.id, name: selected.name })
              }}
            >
              Delete
            </Button>
          </div>
        </div>

        {selected ? (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Changes apply everywhere this book is attached.
            </p>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="context-book-name">Name</Label>
                <Input
                  id="context-book-name"
                  value={name}
                  onChange={(event) => {
                    const nextName = event.target.value
                    withDraft((current) => ({ ...current, name: nextName }))
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="context-book-budget">Token budget</Label>
                <Input
                  id="context-book-budget"
                  type="number"
                  min={1}
                  placeholder="Unlimited"
                  value={book.tokenBudget ?? ""}
                  onChange={(event) =>
                    patchBook({
                      tokenBudget: event.target.value
                        ? Number(event.target.value) || null
                        : null,
                    })
                  }
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Scan messages from</Label>
              <ToggleGroup
                value={[scanRoleChoice(book.scanRoles)]}
                onValueChange={(next) => {
                  const choice = next[0]
                  if (
                    choice === "user" ||
                    choice === "assistant" ||
                    choice === "both"
                  )
                    patchBook({ scanRoles: scanRolesFromChoice(choice) })
                }}
                className="w-full max-w-md"
                variant="outline"
                size="sm"
                spacing={0}
              >
                {(
                  Object.entries(SCAN_ROLE_ITEMS) as [ScanRoleChoice, string][]
                ).map(([value, label]) => (
                  <ToggleGroupItem key={value} value={value} className="flex-1">
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="text-xs text-muted-foreground">
                Entries can override this. Scan depth lives in Chat settings.
              </p>
            </div>

            <div className="space-y-2 rounded-xl border p-3">
              <Label htmlFor="context-book-test">Try a sample message</Label>
              <Textarea
                id="context-book-test"
                value={testText}
                placeholder="Type something a chat might say…"
                onChange={(event) => setTestText(event.target.value)}
              />
              {testText.trim() ? (
                <p className="text-xs text-muted-foreground">
                  {
                    [...testByEntry.values()].filter(
                      (item) => item.status === "included"
                    ).length
                  }{" "}
                  included ·{" "}
                  {
                    [...testByEntry.values()].filter(
                      (item) => item.status !== "included"
                    ).length
                  }{" "}
                  skipped
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Matching badges appear on entries while this field has text.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Entries</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const entry = createContextBookEntry()
                    withDraft((current) => ({
                      ...current,
                      book: {
                        ...current.book,
                        entries: [...current.book.entries, entry],
                      },
                    }))
                    setOpenEntryId(entry.id)
                  }}
                >
                  Add entry
                </Button>
              </div>
              {book.entries.length ? (
                <ul className="space-y-2">
                  {book.entries.map((entry) => (
                    <li key={entry.id}>
                      <EntryEditor
                        entry={entry}
                        open={openEntryId === entry.id}
                        onOpenChange={(open) =>
                          setOpenEntryId(open ? entry.id : null)
                        }
                        decision={testByEntry.get(entry.id)}
                        onChange={(patch) => patchEntry(entry.id, patch)}
                        onRemove={() => {
                          withDraft((current) => ({
                            ...current,
                            book: {
                              ...current.book,
                              entries: current.book.entries.filter(
                                (item) => item.id !== entry.id
                              ),
                            },
                          }))
                          if (openEntryId === entry.id) setOpenEntryId(null)
                        }}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
                  No entries yet. Add one, or import a SillyTavern world info
                  file.
                </p>
              )}
            </div>

            <Button
              type="button"
              disabled={!dirty || update.isPending}
              onClick={() => {
                if (!selected) return
                const nextName = name.trim() || selected.name
                try {
                  update.mutate({
                    id: selected.id,
                    name: nextName,
                    book: readContextBook(book),
                  })
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "Context book is invalid"
                  )
                }
              }}
            >
              {update.isPending ? "Saving…" : "Save book"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {loaded
              ? "No context books yet. Create one or import a SillyTavern world-info JSON, character card, or ZIP."
              : "Loading…"}
          </p>
        )}
      </CardContent>
      <AlertDialog
        open={deleteBook != null}
        onOpenChange={(open) => {
          if (!open) setDeleteBook(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete context book?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteBook
                ? `Delete “${deleteBook.name}”? Chats and spaces using it will lose those entries.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (!deleteBook) return
                remove.mutate({ id: deleteBook.id })
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function EntryEditor({
  entry,
  open,
  onOpenChange,
  decision,
  onChange,
  onRemove,
}: {
  entry: ContextBookEntry
  open: boolean
  onOpenChange: (open: boolean) => void
  decision?: ContextEntryDecision
  onChange: (patch: Partial<ContextBookEntry>) => void
  onRemove: () => void
}) {
  const rule = entry.activation.kind === "match" ? entry.activation : null
  const compatibilityIssues = Array.isArray(entry.source?.compatibilityIssues)
    ? entry.source.compatibilityIssues.map(String)
    : []
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const browserTimeZone = useBrowserTimeZone()
  const catalogContext = useMemo(() => {
    if (!browserTimeZone) return null
    return catalogMacroContext(browserTimeZone)
  }, [browserTimeZone])

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div
        className={cn(
          "rounded-lg border bg-card",
          !entry.enabled && "opacity-70"
        )}
      >
        <div className="flex items-start gap-2 p-3 sm:items-center">
          <Switch
            size="sm"
            className="mt-0.5 shrink-0 sm:mt-0"
            checked={entry.enabled}
            onCheckedChange={(enabled) => onChange({ enabled })}
          />
          <CollapsibleTrigger className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-left">
            <span className="min-w-0 flex-1 basis-32 truncate text-sm font-medium">
              {entry.title.trim() || "Untitled entry"}
            </span>
            <span className="flex flex-wrap items-center gap-1">
              <Badge variant="outline">{triggerLabel(entry)}</Badge>
              {decision ? (
                <Badge
                  variant={
                    decision.status === "included" ? "default" : "secondary"
                  }
                >
                  {STATUS_LABEL[decision.status]}
                </Badge>
              ) : null}
              {compatibilityIssues.length ? (
                <Badge variant="destructive">Needs review</Badge>
              ) : null}
            </span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180"
              )}
            />
          </CollapsibleTrigger>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
            aria-label="Remove entry"
          >
            <HugeiconsIcon icon={Delete02Icon} className="size-4" />
          </Button>
        </div>
        <CollapsibleContent>
          <div className="space-y-3 border-t p-3">
            {compatibilityIssues.length ? (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
                Review before enabling: unsupported SillyTavern{" "}
                {compatibilityIssues.join(", ")}. Original fields stay in this
                entry’s source metadata.
              </p>
            ) : null}
            {decision && decision.status !== "included" ? (
              <p className="text-xs text-muted-foreground">{decision.reason}</p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <div className="space-y-1">
                <Label>Title</Label>
                <Input
                  value={entry.title}
                  placeholder="Entry title"
                  onChange={(event) => onChange({ title: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Activation</Label>
                <Select
                  value={entry.activation.kind}
                  items={{ match: "On match", always: "Always" }}
                  onValueChange={(value) =>
                    onChange({
                      activation:
                        value === "always"
                          ? { kind: "always" }
                          : matchActivation(),
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="match">On match</SelectItem>
                    <SelectItem value="always">Always</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Priority</Label>
                <Input
                  type="number"
                  className="w-full sm:w-24"
                  value={entry.priority}
                  onChange={(event) =>
                    onChange({ priority: Number(event.target.value) })
                  }
                />
              </div>
            </div>
            {rule ? (
              <div className="space-y-3">
                <TriggerListField
                  key={`${entry.id}-primary`}
                  label="Primary triggers"
                  value={rule.keywords}
                  placeholder="One keyword or phrase per line"
                  onCommit={(keywords) =>
                    onChange({ activation: { ...rule, keywords } })
                  }
                />
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      size="sm"
                      checked={rule.match === "all"}
                      onCheckedChange={(on) =>
                        onChange({
                          activation: { ...rule, match: on ? "all" : "any" },
                        })
                      }
                    />
                    Require all
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      size="sm"
                      checked={rule.caseSensitive}
                      onCheckedChange={(caseSensitive) =>
                        onChange({ activation: { ...rule, caseSensitive } })
                      }
                    />
                    Case sensitive
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      size="sm"
                      checked={rule.wholeWord}
                      onCheckedChange={(wholeWord) =>
                        onChange({ activation: { ...rule, wholeWord } })
                      }
                    />
                    Whole words
                  </label>
                </div>
                <Collapsible>
                  <CollapsibleTrigger className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground">
                    Advanced matching
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className="size-3.5"
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-3 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TriggerListField
                        key={`${entry.id}-secondary`}
                        label="Secondary triggers"
                        value={rule.secondary}
                        placeholder="Optional extra conditions"
                        onCommit={(secondary) =>
                          onChange({ activation: { ...rule, secondary } })
                        }
                      />
                      <div className="space-y-1">
                        <Label>Secondary condition</Label>
                        <Select
                          value={rule.secondaryMatch}
                          items={{
                            any: "Any",
                            all: "All",
                            none: "None",
                            not_all: "Not all",
                          }}
                          onValueChange={(value) =>
                            value &&
                            onChange({
                              activation: {
                                ...rule,
                                secondaryMatch: String(
                                  value
                                ) as typeof rule.secondaryMatch,
                              },
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="any">Any</SelectItem>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="none">None</SelectItem>
                            <SelectItem value="not_all">Not all</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ScanDepthField
                        inherit
                        compact
                        value={rule.scanMessages}
                        onChange={(scanMessages) =>
                          onChange({ activation: { ...rule, scanMessages } })
                        }
                      />
                      <div className="grid gap-2">
                        <Label>Scan roles</Label>
                        <Select
                          value={rule.scanRoles?.join("+") ?? "default"}
                          items={{
                            default: "Use book default",
                            user: "User only",
                            assistant: "Assistant only",
                            "user+assistant": "User and assistant",
                          }}
                          onValueChange={(value) =>
                            value &&
                            onChange({
                              activation: {
                                ...rule,
                                scanRoles:
                                  value === "default"
                                    ? undefined
                                    : (String(value).split("+") as (
                                        | "user"
                                        | "assistant"
                                      )[]),
                              },
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">
                              Use book default
                            </SelectItem>
                            <SelectItem value="user">User only</SelectItem>
                            <SelectItem value="assistant">
                              Assistant only
                            </SelectItem>
                            <SelectItem value="user+assistant">
                              User and assistant
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label>Namespace</Label>
                      <Input
                        value={entry.namespace}
                        onChange={(event) =>
                          onChange({ namespace: event.target.value })
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Prompt stacks can insert a namespace with{" "}
                        <code>{'{{contextEntries("name")}}'}</code>.
                      </p>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            ) : (
              <div className="space-y-1">
                <Label>Namespace</Label>
                <Input
                  value={entry.namespace}
                  onChange={(event) =>
                    onChange({ namespace: event.target.value })
                  }
                />
              </div>
            )}
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <Label>Content</Label>
                <MacroPicker
                  catalogContext={catalogContext}
                  onInsert={(snippet) => {
                    const field = contentRef.current
                    const current = field?.value ?? entry.content
                    const start = field?.selectionStart ?? current.length
                    const end = field?.selectionEnd ?? start
                    onChange({
                      content:
                        current.slice(0, start) + snippet + current.slice(end),
                    })
                  }}
                />
              </div>
              <Textarea
                ref={contentRef}
                className="min-h-28 font-mono"
                value={entry.content}
                onChange={(event) => onChange({ content: event.target.value })}
              />
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
