"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  ArrowDown01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { spaceChain, spaceFromRow, spacesById } from "@/lib/space"
import { useTRPC } from "@/lib/trpc-react"
import type { SpaceRow } from "@/lib/types"
import { useMediaMdUp } from "./hooks"

export type InheritedContextBook = {
  spaceId: string
  spaceName: string
}

export function inheritedContextBooks(
  spaceId: string | null,
  spaces: SpaceRow[],
  includeCurrent: boolean
): Map<string, InheritedContextBook> {
  const inherited = new Map<string, InheritedContextBook>()
  const chain = spaceChain(spaceId, spacesById(spaces.map(spaceFromRow)))
  for (const space of chain) {
    if (!includeCurrent && space.id === spaceId) continue
    if (space.settings.books?.reset) inherited.clear()
    for (const [bookId, decision] of Object.entries(
      space.settings.books?.decisions ?? {}
    )) {
      if (decision === "exclude") inherited.delete(bookId)
      else
        inherited.set(bookId, {
          spaceId: space.id,
          spaceName: space.name,
        })
    }
  }
  return inherited
}

function bookTriggerLabel(
  books: Array<{ id: string; name: string }>,
  effectiveIds: string[]
) {
  if (effectiveIds.length === 0) return "Books"
  if (effectiveIds.length === 1) {
    const name = books.find((book) => book.id === effectiveIds[0])?.name
    return name ?? "Books"
  }
  return `Books · ${effectiveIds.length}`
}

export function ContextBookPicker({
  chatId,
  spaceId,
  spaces,
  draftIds = [],
  onDraftChange,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: {
  chatId?: string
  spaceId: string | null
  spaces: SpaceRow[]
  draftIds?: string[]
  onDraftChange?: (ids: string[]) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}) {
  const trpc = useTRPC()
  const client = useQueryClient()
  const router = useRouter()
  const mdUp = useMediaMdUp()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : uncontrolledOpen
  function setOpen(next: boolean) {
    if (!controlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  const settings = useQuery(trpc.workspace.getSettings.queryOptions())
  const books = settings.data?.contextBooks ?? []
  const attached = useQuery({
    ...trpc.workspace.listChatContextBooks.queryOptions({
      chatId: chatId ?? "",
    }),
    enabled: Boolean(chatId),
  })
  const attachedIds = chatId ? (attached.data ?? []) : draftIds
  const inherited = useMemo(
    () => inheritedContextBooks(spaceId, spaces, true),
    [spaceId, spaces]
  )
  const mutation = useMutation(
    trpc.workspace.setChatContextBooks.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          attached.refetch(),
          client.invalidateQueries(trpc.workspace.get.queryFilter()),
        ])
        toast.success("Context books updated")
      },
      onError: (error) => toast.error(error.message),
    })
  )
  const effectiveIds = [...new Set([...inherited.keys(), ...attachedIds])]
  const label = bookTriggerLabel(books, effectiveIds)

  function commit(next: string[]) {
    if (chatId) mutation.mutate({ chatId, bookIds: next })
    else onDraftChange?.(next)
  }

  const listBody = (
    <ContextBookAttachList
      books={books}
      attachedIds={attachedIds}
      inherited={inherited}
      disabled={mutation.isPending}
      onChange={commit}
      onManage={() => {
        setOpen(false)
        router.push("/settings")
      }}
    />
  )

  if (hideTrigger) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Context books</DialogTitle>
          </DialogHeader>
          {listBody}
        </DialogContent>
      </Dialog>
    )
  }

  if (mdUp) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="max-w-[min(9rem,24vw)] min-w-0 truncate"
              title={label}
              aria-label={`Context books: ${label}`}
            />
          }
        >
          <span className="truncate">{label}</span>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-3">
          {listBody}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="max-w-[7rem] min-w-0 truncate px-2"
        onClick={() => setOpen(true)}
        title={label}
        aria-label={`Context books: ${label}`}
      >
        <span className="truncate">Books</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Context books</DialogTitle>
          </DialogHeader>
          {listBody}
        </DialogContent>
      </Dialog>
    </>
  )
}

export function ContextBookAttachList({
  books,
  attachedIds,
  inherited,
  disabled = false,
  onChange,
  onManage,
}: {
  books: Array<{ id: string; name: string }>
  attachedIds: string[]
  inherited: Map<string, InheritedContextBook>
  disabled?: boolean
  onChange: (ids: string[]) => void
  onManage?: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Attach books to this chat. Space books stay in the same pool unless the
        space excludes them.
      </p>
      {books.length ? (
        <ul className="max-h-60 space-y-1 overflow-y-auto">
          {books.map((book) => {
            const from = inherited.get(book.id)
            const attached = attachedIds.includes(book.id)
            const checked = Boolean(from) || attached
            return (
              <li key={book.id}>
                <label
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2 text-sm",
                    checked && "bg-muted"
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{book.name}</span>
                    {from ? (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        From{" "}
                        <Link
                          href={`/space/${from.spaceId}`}
                          className="font-medium text-foreground underline-offset-2 hover:underline"
                        >
                          {from.spaceName}
                        </Link>
                      </span>
                    ) : null}
                  </span>
                  <Switch
                    size="sm"
                    checked={checked}
                    disabled={Boolean(from) || disabled}
                    onCheckedChange={(on) => {
                      onChange(
                        on
                          ? [...attachedIds, book.id]
                          : attachedIds.filter((id) => id !== book.id)
                      )
                    }}
                  />
                </label>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No context books yet. Create one in Settings, then attach it here or
          on a space.
        </p>
      )}
      {onManage ? (
        <div className="flex flex-wrap gap-2 border-t pt-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-xs"
            onClick={onManage}
          >
            {books.length ? "Edit in Settings" : "Create in Settings"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function SpaceContextBooksCard({
  books,
  attachedIds,
  inherited,
  excludedIds = [],
  reset = false,
  entryDecisions = {},
  onChange,
  onExclude,
  onReset,
  onEntryChange,
}: {
  books: Array<{
    id: string
    name: string
    book?: { entries: Array<{ id: string; title: string }> }
  }>
  attachedIds: string[]
  inherited: Map<string, InheritedContextBook>
  excludedIds?: string[]
  reset?: boolean
  entryDecisions?: Record<string, Record<string, "disable" | "restore">>
  onChange: (ids: string[]) => void
  onExclude?: (id: string, excluded: boolean) => void
  onReset?: (reset: boolean) => void
  onEntryChange?: (
    decisions: Record<string, Record<string, "disable" | "restore">>
  ) => void
}) {
  const bookById = useMemo(
    () => new Map(books.map((book) => [book.id, book])),
    [books]
  )
  const available = books.filter(
    (book) =>
      !attachedIds.includes(book.id) &&
      !inherited.has(book.id) &&
      !excludedIds.includes(book.id)
  )
  const localBooks = attachedIds.map((id) => ({
    id,
    name: bookById.get(id)?.name,
  }))
  const inheritedBooks = [...inherited.entries()]
    .filter(([id]) => !excludedIds.includes(id))
    .map(([id, from]) => ({
      id,
      name: bookById.get(id)?.name,
      from,
    }))
  const excludedBooks = excludedIds.map((id) => ({
    id,
    name: bookById.get(id)?.name,
  }))
  const collectionIds = new Set([
    ...attachedIds,
    ...inheritedBooks.map((book) => book.id),
  ])

  return (
    <div className="grid gap-3 rounded-2xl border bg-background/40 p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">Context books</p>
        <p className="text-[11px] text-muted-foreground">
          Attach books for chats here. Inherited books stay unless you exclude
          them.
        </p>
      </div>
      {onReset ? (
        <label className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            <span className="block truncate">Start a fresh collection</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              Books from parent spaces will not apply here.
            </span>
          </span>
          <Switch size="sm" checked={reset} onCheckedChange={onReset} />
        </label>
      ) : null}
      {inheritedBooks.length || localBooks.length || excludedBooks.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {inheritedBooks.map((book) => (
            <li key={`inherited-${book.id}`}>
              <Badge variant="outline" className="max-w-full gap-1 sm:max-w-48">
                <span className="truncate">{book.name ?? "Missing book"}</span>
                <Link
                  href={`/space/${book.from.spaceId}`}
                  className="text-muted-foreground hover:text-foreground"
                  title={`From ${book.from.spaceName}`}
                >
                  {book.from.spaceName}
                </Link>
                {onExclude ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Exclude ${book.name ?? "book"} in this space`}
                    onClick={() => onExclude(book.id, true)}
                  >
                    <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
                  </Button>
                ) : null}
              </Badge>
            </li>
          ))}
          {excludedBooks.map((book) => (
            <li key={`excluded-${book.id}`}>
              <Badge
                variant="outline"
                className="max-w-full gap-1 border-dashed opacity-70"
              >
                <span className="truncate">
                  {book.name ?? "Missing book"} · excluded
                </span>
                {onExclude ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Include ${book.name ?? "book"} again`}
                    onClick={() => onExclude(book.id, false)}
                  >
                    <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
                  </Button>
                ) : null}
              </Badge>
            </li>
          ))}
          {localBooks.map((book) => (
            <li key={`local-${book.id}`}>
              <Badge
                variant="secondary"
                className="max-w-full gap-0.5 pr-1 sm:max-w-52"
              >
                <span className="truncate">{book.name ?? "Missing book"}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${book.name ?? "book"}`}
                  onClick={() =>
                    onChange(attachedIds.filter((id) => id !== book.id))
                  }
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {books.length
            ? "None attached yet."
            : "Create context books in Settings, then attach them here."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {available.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button type="button" variant="outline" size="sm" />}
            >
              <HugeiconsIcon icon={Add01Icon} className="size-4" />
              Add book
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-52">
              {available.map((book) => (
                <DropdownMenuItem
                  key={book.id}
                  onClick={() => onChange([...attachedIds, book.id])}
                >
                  {book.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <Link
          href="/settings"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "text-xs"
          )}
        >
          {books.length ? "Edit in Settings" : "Create in Settings"}
        </Link>
      </div>
      {onEntryChange ? (
        <SpaceEntryExceptions
          books={books.filter((book) => collectionIds.has(book.id))}
          decisions={entryDecisions}
          onChange={onEntryChange}
        />
      ) : null}
    </div>
  )
}

function SpaceEntryExceptions({
  books,
  decisions,
  onChange,
}: {
  books: Array<{
    id: string
    name: string
    book?: { entries: Array<{ id: string; title: string }> }
  }>
  decisions: Record<string, Record<string, "disable" | "restore">>
  onChange: (
    decisions: Record<string, Record<string, "disable" | "restore">>
  ) => void
}) {
  const configured = Object.values(decisions).reduce(
    (count, entries) => count + Object.keys(entries).length,
    0
  )
  const excepted = books.flatMap((book) =>
    Object.entries(decisions[book.id] ?? {}).flatMap(([entryId, action]) => {
      const entry = book.book?.entries.find((item) => item.id === entryId)
      if (!entry) return []
      return [{ book, entry, action }]
    })
  )
  const addable = books.flatMap((book) =>
    (book.book?.entries ?? [])
      .filter((entry) => !decisions[book.id]?.[entry.id])
      .map((entry) => ({ book, entry }))
  )

  if (!configured && !addable.length) return null

  function patch(
    bookId: string,
    entryId: string,
    action: "disable" | "restore" | "inherit"
  ) {
    const next = Object.fromEntries(
      Object.entries(decisions).map(([id, entries]) => [id, { ...entries }])
    )
    const entries = (next[bookId] ??= {})
    if (action === "inherit") delete entries[entryId]
    else entries[entryId] = action
    if (Object.keys(entries).length === 0) delete next[bookId]
    onChange(next)
  }

  return (
    <Collapsible className="group/exceptions space-y-1">
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
        Entry exceptions{configured ? ` (${configured})` : ""}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="size-3.5 shrink-0 transition-transform group-data-open/exceptions:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mb-2 text-[11px] text-muted-foreground">
          Disable an inherited entry here, or restore one a parent space turned
          off.
        </p>
        {excepted.length ? (
          <ul className="grid gap-1">
            {excepted.map(({ book, entry, action }) => (
              <li
                key={`${book.id}:${entry.id}`}
                className="flex items-center justify-between gap-3 rounded-xl px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{entry.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {book.name}
                  </span>
                </span>
                <Select
                  value={action}
                  onValueChange={(raw) => {
                    if (
                      raw !== "disable" &&
                      raw !== "restore" &&
                      raw !== "inherit"
                    )
                      return
                    patch(book.id, entry.id, raw)
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-28"
                    aria-label={`${entry.title} policy`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">Inherit</SelectItem>
                    <SelectItem value="disable">Disable</SelectItem>
                    <SelectItem value="restore">Restore</SelectItem>
                  </SelectContent>
                </Select>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">None yet.</p>
        )}
        {addable.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2 text-xs"
                />
              }
            >
              <HugeiconsIcon icon={Add01Icon} className="size-3.5" />
              Add exception
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-52">
              {addable.map(({ book, entry }) => (
                <DropdownMenuItem
                  key={`${book.id}:${entry.id}`}
                  onClick={() => patch(book.id, entry.id, "disable")}
                >
                  {entry.title}
                  <span className="ms-auto text-[11px] text-muted-foreground">
                    {book.name}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  )
}
