"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/lib/trpc-react"
import { useMediaMdUp } from "./hooks"

export function PromptStackPicker({
  chatId,
  promptStackId,
  onChanged,
  draftStackId,
  onDraftChange,
}: {
  chatId?: string
  /** Chat's prompt_stack_id (null = inherit). */
  promptStackId: string | null
  onChanged?: () => void | Promise<void>
  /** Draft chats before first message: local-only selection. */
  draftStackId?: string | null
  onDraftChange?: (stackId: string | null) => void
}) {
  const trpc = useTRPC()
  const router = useRouter()
  const mdUp = useMediaMdUp()
  const [open, setOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)

  const settingsQuery = useQuery(trpc.workspace.getSettings.queryOptions())
  const stacks = settingsQuery.data?.promptStacks ?? []
  const defaultId = settingsQuery.data?.defaultPromptStackId ?? null
  const defaultStack = stacks.find((s) => s.id === defaultId)

  const activeRef = chatId ? promptStackId : (draftStackId ?? null)
  const selectedStack = activeRef
    ? stacks.find((s) => s.id === activeRef)
    : null
  const isOrphan = Boolean(activeRef && !selectedStack)
  const inherits = activeRef === null

  const label = inherits
    ? defaultStack
      ? `Stack · ${defaultStack.name}`
      : "Prompt stack"
    : isOrphan
      ? "Missing stack"
      : selectedStack!.name

  const setMut = useMutation(
    trpc.workspace.setChatPromptStack.mutationOptions({
      onSuccess: async () => {
        toast.success("Prompt stack updated")
        await onChanged?.()
        setOpen(false)
      },
      onError: (e) => toast.error(e.message || "Could not update"),
    })
  )

  async function selectStack(stackId: string | null) {
    if (!chatId) {
      onDraftChange?.(stackId)
      setOpen(false)
      return
    }
    await setMut.mutateAsync({ chatId, stackId })
  }

  const previewQuery = useQuery({
    ...trpc.workspace.previewAssembledContext.queryOptions({
      chatId: chatId ?? undefined,
      stackId: activeRef ?? undefined,
    }),
    enabled: inspectorOpen,
  })

  const listBody = (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Shared stacks from Settings. This chat only stores a reference.
      </p>
      {isOrphan ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Previous stack was removed. Generations use the instance default until
          you pick another.
        </p>
      ) : null}
      <ul className="max-h-60 space-y-1 overflow-y-auto">
        <li>
          <button
            type="button"
            className={cn(
              "flex w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-muted",
              inherits && "bg-muted"
            )}
            onClick={() => void selectStack(null)}
          >
            <span className="min-w-0 flex-1 truncate">
              Instance default
              {defaultStack ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {defaultStack.name}
                </span>
              ) : null}
            </span>
          </button>
        </li>
        {stacks.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className={cn(
                "flex w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-muted",
                activeRef === s.id && "bg-muted"
              )}
              onClick={() => void selectStack(s.id)}
            >
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              {s.id === defaultId ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  default
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 border-t pt-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-xs"
          onClick={() => setInspectorOpen(true)}
        >
          Resolved context
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-xs"
          onClick={() => {
            setOpen(false)
            router.push("/settings")
          }}
        >
          Edit in Settings
        </Button>
      </div>
    </div>
  )

  return (
    <>
      {mdUp ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "max-w-[min(12rem,30vw)] min-w-0 truncate",
                  isOrphan && "text-destructive"
                )}
                title={label}
                aria-label={`Prompt stack: ${label}`}
              />
            }
          >
            <span className="truncate">{label}</span>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-3">
            {listBody}
          </PopoverContent>
        </Popover>
      ) : (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "min-w-0 max-w-[9rem] truncate px-2",
              isOrphan && "text-destructive"
            )}
            onClick={() => setOpen(true)}
            title={label}
            aria-label={`Prompt stack: ${label}`}
          >
            <span className="truncate">{label}</span>
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Prompt stack</DialogTitle>
              </DialogHeader>
              {listBody}
            </DialogContent>
          </Dialog>
        </>
      )}

      <Dialog open={inspectorOpen} onOpenChange={setInspectorOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Resolved context</DialogTitle>
          </DialogHeader>
          {previewQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : previewQuery.isError ? (
            <p className="text-sm text-destructive">
              {previewQuery.error.message || "Could not load preview"}
            </p>
          ) : previewQuery.data ? (
            <ResolvedContextView data={previewQuery.data} />
          ) : (
            <p className="text-sm text-muted-foreground">No preview available.</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function ResolvedContextView({
  data,
}: {
  data: {
    source: string
    stackId: string | null
    missingStackId?: string
    system: string
    messages: Array<{ role: string; content: unknown }>
    demotedModuleIds?: string[]
    warnings?: Array<{ moduleId: string; message: string }>
  }
}) {
  const messageSummaries = useMemo(
    () =>
      data.messages.map((msg, i) => ({
        i,
        role: msg.role,
        text: contentPreview(msg.content),
      })),
    [data.messages]
  )

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">
        Source: {data.source}
        {data.missingStackId ? " · previous stack missing" : ""}
      </p>
      {data.warnings && data.warnings.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {data.warnings.map((w) => (
            <li key={w.moduleId}>{w.message}</li>
          ))}
        </ul>
      ) : null}
      {data.system ? (
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            System
          </p>
          <pre className="max-h-40 overflow-auto rounded-lg border bg-muted/40 p-2 whitespace-pre-wrap text-xs">
            {data.system}
          </pre>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No system string.</p>
      )}
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Messages ({messageSummaries.length})
        </p>
        <ul className="space-y-2">
          {messageSummaries.map((m) => (
            <li key={m.i} className="rounded-lg border p-2">
              <p className="text-xs font-medium text-muted-foreground">
                {m.role}
              </p>
              <p className="mt-0.5 line-clamp-4 text-xs whitespace-pre-wrap">
                {m.text || "—"}
              </p>
            </li>
          ))}
          {messageSummaries.length === 0 ? (
            <li className="text-xs text-muted-foreground">No path messages.</li>
          ) : null}
        </ul>
      </div>
    </div>
  )
}

function contentPreview(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part
        if (part && typeof part === "object" && "text" in part)
          return String((part as { text: string }).text)
        if (part && typeof part === "object" && "type" in part)
          return `[${String((part as { type: string }).type)}]`
        return ""
      })
      .filter(Boolean)
      .join("\n")
  }
  if (content == null) return ""
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}
