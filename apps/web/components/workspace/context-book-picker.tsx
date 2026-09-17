"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
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
    for (const bookId of space.settings.contextBooks ?? []) {
      if (inherited.has(bookId)) continue
      inherited.set(bookId, { spaceId: space.id, spaceName: space.name })
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
        Attach books to this chat. Space books stay on and add to the same pool.
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
  onChange,
}: {
  books: Array<{ id: string; name: string }>
  attachedIds: string[]
  inherited: Map<string, InheritedContextBook>
  onChange: (ids: string[]) => void
}) {
  const bookById = useMemo(
    () => new Map(books.map((book) => [book.id, book])),
    [books]
  )
  const available = books.filter(
    (book) => !attachedIds.includes(book.id) && !inherited.has(book.id)
  )
  const localBooks = attachedIds.map((id) => ({
    id,
    name: bookById.get(id)?.name,
  }))
  const inheritedBooks = [...inherited.entries()].map(([id, from]) => ({
    id,
    name: bookById.get(id)?.name,
    from,
  }))

  return (
    <div className="grid gap-3 rounded-2xl border bg-background/40 p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">Context books</p>
        <p className="text-[11px] text-muted-foreground">
          Attached books add to parent spaces. Chats here can attach more.
        </p>
      </div>
      {inheritedBooks.length || localBooks.length ? (
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
    </div>
  )
}
