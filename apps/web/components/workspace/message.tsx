"use client"

import { Fragment, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  Edit02Icon,
  InformationCircleIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { TooltipProvider, WithTooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { NodeRow, Parts } from "@/lib/types"
import { parseJson, textFromParts } from "@/lib/domain"
import { useTRPC } from "@/lib/trpc-react"
import { Markdown } from "@/components/markdown"
import type { ProviderSummary } from "./types"

export function MessageAction({
  icon,
  children,
  onClick,
  destructive,
  captions,
}: {
  icon: typeof RefreshIcon
  children: string
  onClick: () => void
  destructive?: boolean
  captions: boolean
}) {
  const button = (
    <Button
      type="button"
      variant="ghost"
      size={captions ? "xs" : "icon-xs"}
      className={cn(
        captions
          ? "h-7 gap-1 px-2 text-xs font-normal"
          : "size-7 text-muted-foreground hover:text-foreground",
        destructive && "text-destructive hover:text-destructive"
      )}
      onClick={onClick}
      aria-label={children}
    >
      <HugeiconsIcon
        icon={icon}
        strokeWidth={2}
        className="size-3.5 shrink-0"
        aria-hidden
      />
      {captions ? <span className="leading-none">{children}</span> : null}
    </Button>
  )

  if (captions) return button

  return <WithTooltip label={children}>{button}</WithTooltip>
}

export function Message({
  node,
  nodes,
  providers,
  animate,
  transition,
  messageActionCaptions,
  onSelect,
  onChanged,
  onRegenerate,
  onGenerateUnder,
}: {
  node: NodeRow
  nodes: NodeRow[]
  providers: ProviderSummary[]
  animate?: boolean
  transition?: { duration: number; ease: [number, number, number, number] }
  messageActionCaptions: boolean
  onSelect: (parentId: string, childId: string) => void
  onChanged?: () => void | Promise<void>
  onRegenerate?: () => void
  onGenerateUnder?: (parentNodeId: string) => void | Promise<void>
}) {
  const trpc = useTRPC()
  const parts = parseJson<Parts>(node.parts_json, [])
  const metadata = parseJson<Record<string, unknown>>(node.metadata_json, {})
  const text = textFromParts(parts)
  const siblings = nodes.filter(
    (candidate) =>
      candidate.parent_id === node.parent_id && candidate.role === node.role
  )
  const index = siblings.findIndex((candidate) => candidate.id === node.id)
  const [editOpen, setEditOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [editText, setEditText] = useState(text)
  const [deleteOpen, setDeleteOpen] = useState(false)
  // Path slots reuse this instance across sibling switches. Reset UI when the
  // bound node identity changes (render-time adjust; keep article shell mounted).
  const [boundNodeId, setBoundNodeId] = useState(node.id)
  if (node.id !== boundNodeId) {
    setBoundNodeId(node.id)
    setEditOpen(false)
    setDetailsOpen(false)
    setDeleteOpen(false)
    setEditText(text)
  }

  const providerName =
    providers.find((p) => p.id === metadata.provider)?.name ??
    (typeof metadata.provider === "string" ? metadata.provider : "—")

  const forkEditMutation = useMutation(
    trpc.workspace.forkEdit.mutationOptions({
      onSuccess: async (result) => {
        setEditOpen(false)
        const forked = result.node
        // Wait for workspace refresh so soft-follow sees the forked tip
        // (server already attached selection to the new branch).
        await Promise.resolve(onChanged?.())
        if (forked.role === "user" && onGenerateUnder) {
          await onGenerateUnder(forked.id)
        }
      },
      onError: (error) => toast.error(error.message || "Edit failed"),
    })
  )
  const deleteNodeMutation = useMutation(
    trpc.workspace.deleteNode.mutationOptions({
      onSuccess: () => {
        setDeleteOpen(false)
        onChanged?.()
      },
      onError: (error) => toast.error(error.message || "Delete failed"),
    })
  )

  const usage = metadata.usage
  const usageEntries =
    usage && typeof usage === "object" && !Array.isArray(usage)
      ? Object.entries(usage as Record<string, unknown>)
      : null

  return (
    <article
      className={cn(
        "group relative min-w-0 overflow-hidden rounded-xl border",
        node.role === "user" ? "ml-auto max-w-[88%] bg-muted/40" : "bg-card"
      )}
    >
      <AnimatePresence mode="sync" initial={false}>
        <motion.div
          key={node.id}
          className="w-full p-4"
          initial={animate ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          exit={
            animate
              ? {
                  opacity: 0,
                  // Out-of-flow so enter defines height; stay full-bleed inside
                  // the border (padding lives on this node so both layers match).
                  position: "absolute",
                  inset: 0,
                }
              : undefined
          }
          transition={transition}
        >
          <div className="mb-2 flex items-center justify-between text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <span>{node.role}</span>
            {siblings.length > 1 && (
              <span className="flex items-center gap-1">
                <WithTooltip label="Previous branch">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={index === 0}
                    aria-label="Previous branch"
                    onClick={() => {
                      const previous = siblings[index - 1]
                      if (previous) onSelect(node.parent_id ?? "", previous.id)
                    }}
                  >
                    <HugeiconsIcon
                      icon={ArrowLeft01Icon}
                      strokeWidth={2}
                      className="size-3.5"
                      aria-hidden
                    />
                  </Button>
                </WithTooltip>
                <span aria-live="polite">
                  {index + 1}/{siblings.length}
                </span>
                <WithTooltip label="Next branch">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={index === siblings.length - 1}
                    aria-label="Next branch"
                    onClick={() => {
                      const next = siblings[index + 1]
                      if (next) onSelect(node.parent_id ?? "", next.id)
                    }}
                  >
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      strokeWidth={2}
                      className="size-3.5"
                      aria-hidden
                    />
                  </Button>
                </WithTooltip>
              </span>
            )}
          </div>
          {parts.some((part) => part.type === "reasoning") && (
            <details className="mb-3 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Reasoning</summary>
              {parts
                .filter((part) => part.type === "reasoning")
                .map((part, i) => (
                  <p key={i} className="mt-2 whitespace-pre-wrap">
                    {part.text}
                  </p>
                ))}
            </details>
          )}
          <div className="prose prose-sm dark:prose-invert max-w-none">
            {node.role === "assistant" ? (
              <Markdown>
                {text || (node.status === "streaming" ? "Thinking…" : "")}
              </Markdown>
            ) : (
              <p className="whitespace-pre-wrap">{text}</p>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-0.5">
            <TooltipProvider delay={400}>
              {node.role === "assistant" && onRegenerate && (
                <MessageAction
                  onClick={() => onRegenerate()}
                  icon={RefreshIcon}
                  captions={messageActionCaptions}
                >
                  Regenerate
                </MessageAction>
              )}
              <MessageAction
                onClick={() => {
                  setEditText(text)
                  setEditOpen(true)
                }}
                icon={Edit02Icon}
                captions={messageActionCaptions}
              >
                Edit as branch
              </MessageAction>
              {node.role === "assistant" &&
                Object.keys(metadata).length > 0 && (
                  <MessageAction
                    onClick={() => setDetailsOpen(true)}
                    icon={InformationCircleIcon}
                    captions={messageActionCaptions}
                  >
                    Details
                  </MessageAction>
                )}
              <MessageAction
                onClick={() => setDeleteOpen(true)}
                icon={Delete02Icon}
                destructive
                captions={messageActionCaptions}
              >
                Delete
              </MessageAction>
            </TooltipProvider>
          </div>
          {node.status === "error" && (
            <p className="mt-3 text-xs break-words text-destructive">
              {typeof metadata.error === "string" && metadata.error
                ? metadata.error
                : "This response did not complete."}
            </p>
          )}

          <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Response details</DialogTitle>
              </DialogHeader>
              <dl className="grid min-w-0 grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Provider</dt>
                <dd className="min-w-0 break-all">{providerName}</dd>
                <dt className="text-muted-foreground">Model</dt>
                <dd className="min-w-0 break-all">
                  {String(metadata.model ?? "—")}
                </dd>
                <dt className="text-muted-foreground">Finish</dt>
                <dd className="min-w-0 break-all">
                  {String(metadata.finishReason ?? "—")}
                </dd>
                {metadata.finishedAt != null && (
                  <>
                    <dt className="text-muted-foreground">Finished</dt>
                    <dd className="min-w-0 break-all">
                      {String(metadata.finishedAt)}
                    </dd>
                  </>
                )}
                {typeof metadata.error === "string" && metadata.error && (
                  <>
                    <dt className="text-muted-foreground">Error</dt>
                    <dd className="min-w-0 break-words text-destructive">
                      {metadata.error}
                    </dd>
                  </>
                )}
              </dl>
              <div className="min-w-0">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Usage
                </p>
                {usageEntries ? (
                  <dl className="grid max-h-48 grid-cols-[auto_1fr] gap-x-3 gap-y-1 overflow-y-auto text-xs">
                    {usageEntries.map(([key, value]) => (
                      <Fragment key={key}>
                        <dt className="text-muted-foreground">{key}</dt>
                        <dd className="min-w-0 break-all">
                          {typeof value === "object"
                            ? JSON.stringify(value)
                            : String(value)}
                        </dd>
                      </Fragment>
                    ))}
                  </dl>
                ) : (
                  <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-2 font-mono text-xs break-all whitespace-pre-wrap">
                    {usage ? JSON.stringify(usage, null, 2) : "—"}
                  </pre>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDetailsOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit as branch</DialogTitle>
              </DialogHeader>
              <Textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={6}
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditOpen(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={!editText.trim()}
                  onClick={() =>
                    forkEditMutation.mutate({
                      nodeId: node.id,
                      parts: [{ type: "text", text: editText }],
                    })
                  }
                >
                  {node.role === "user" ? "Save & generate" : "Save branch"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete message node</AlertDialogTitle>
                <AlertDialogDescription>
                  Subtree delete removes this node and all descendants. Reparent
                  only works when there is exactly one child (promotes that
                  child).
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button
                  variant="outline"
                  onClick={() =>
                    deleteNodeMutation.mutate({
                      nodeId: node.id,
                      mode: "reparent",
                    })
                  }
                >
                  Reparent
                </Button>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() =>
                    deleteNodeMutation.mutate({
                      nodeId: node.id,
                      mode: "subtree",
                    })
                  }
                >
                  Delete subtree
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </motion.div>
      </AnimatePresence>
    </article>
  )
}
