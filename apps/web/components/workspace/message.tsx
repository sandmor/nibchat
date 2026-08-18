"use client"

import { Fragment, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Copy01Icon,
  Delete02Icon,
  Edit02Icon,
  GitBranchIcon,
  InformationCircleIcon,
  MoreHorizontalIcon,
  RefreshIcon,
  ViewIcon,
  ViewOffIcon,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { copyText } from "@/lib/clipboard"
import { partsToMarkdown, pathToMarkdown } from "@/lib/message-markdown"
import type { NodeRow, Parts } from "@/lib/types"
import { parseJson, textFromParts } from "@/lib/domain"
import {
  parseProviderModelsJson,
  resolveModelLabel,
} from "@/lib/provider-models"
import { useTRPC } from "@/lib/trpc-react"
import { patchContextExcluded, type WorkspaceData } from "@/lib/workspace-cache"
import { Markdown } from "@/components/markdown"
import type { ProviderSummary } from "./types"
import { MessageParts } from "./message-parts"
import { useWorkspaceChrome } from "./shell"
import {
  allPendingResultsReady,
  hasToolInvocations,
  pendingToolInvocations,
} from "@/lib/agent/parts"

export function MessageAction({
  icon,
  children,
  onClick,
  destructive,
  captions,
  disabled,
}: {
  icon: typeof RefreshIcon
  children: string
  onClick: () => void
  destructive?: boolean
  captions: boolean
  disabled?: boolean
}) {
  const button = (
    <Button
      type="button"
      variant="ghost"
      size={captions ? "xs" : "icon-xs"}
      className={messageActionClass(captions, destructive)}
      onClick={onClick}
      disabled={disabled}
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

function messageActionClass(captions: boolean, destructive?: boolean) {
  return cn(
    captions
      ? "h-7 gap-1 px-2 text-xs font-normal"
      : "size-7 text-muted-foreground hover:text-foreground",
    destructive && "text-destructive hover:text-destructive"
  )
}

function MoreActionsTrigger({ captions }: { captions: boolean }) {
  const trigger = (
    <DropdownMenuTrigger
      render={
        <Button
          type="button"
          variant="ghost"
          size={captions ? "xs" : "icon-xs"}
          className={messageActionClass(captions)}
          aria-label="More"
        />
      }
    >
      <HugeiconsIcon
        icon={MoreHorizontalIcon}
        strokeWidth={2}
        className="size-3.5 shrink-0"
        aria-hidden
      />
      {captions ? <span className="leading-none">More</span> : null}
    </DropdownMenuTrigger>
  )
  if (captions) return trigger
  return <WithTooltip label="More">{trigger}</WithTooltip>
}

export function Message({
  node,
  nodes,
  providers,
  messageActionCaptions,
  onSelect,
  onChanged,
  onRegenerate,
  onGenerateUnder,
  onAnswerTools,
  presentation = "linear",
  attachSelectionOnEdit = true,
}: {
  node: NodeRow
  nodes: NodeRow[]
  providers: ProviderSummary[]
  messageActionCaptions: boolean
  onSelect?: (parentId: string, childId: string) => void
  onChanged?: () => void | Promise<void>
  onRegenerate?: () => void
  onGenerateUnder?: (parentNodeId: string) => void | Promise<void>
  onAnswerTools?: (
    assistantNodeId: string,
    toolResults: Array<{ toolCallId: string; output: unknown }>
  ) => void | Promise<void>
  /** Tree cards retain message actions but never mutate linear branch selection. */
  presentation?: "linear" | "tree"
  /** Tree edits create real branches without changing Linear's selected path. */
  attachSelectionOnEdit?: boolean
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const parts = parseJson<Parts>(node.parts_json, [])
  const metadata = parseJson<Record<string, unknown>>(node.metadata_json, {})
  const text = textFromParts(parts)
  const editableText = parts
    .filter(
      (part): part is Extract<Parts[number], { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("\n")
  const toolful = hasToolInvocations(parts)
  const canEditAsBranch = !toolful
  const interactiveTools =
    node.role === "assistant" &&
    node.status === "awaiting_input" &&
    Boolean(onAnswerTools)
  const pendingIds = pendingToolInvocations(parts).map((p) => p.toolCallId)
  const siblings = nodes.filter(
    (candidate) =>
      candidate.parent_id === node.parent_id && candidate.role === node.role
  )
  const index = siblings.findIndex((candidate) => candidate.id === node.id)
  const [editOpen, setEditOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [editText, setEditText] = useState(editableText)
  const [deleteOpen, setDeleteOpen] = useState(false)
  /** Local answers for multi-pending tools before a single resume fires. */
  const [localToolResults, setLocalToolResults] = useState<
    Record<string, unknown>
  >({})
  const [resumeInFlight, setResumeInFlight] = useState(false)
  // Path slots reuse this instance across sibling switches. Reset UI when the
  // bound node identity changes (render-time adjust; keep article shell mounted).
  const [boundNodeId, setBoundNodeId] = useState(node.id)
  if (node.id !== boundNodeId) {
    setBoundNodeId(node.id)
    setEditOpen(false)
    setDetailsOpen(false)
    setDeleteOpen(false)
    setEditText(editableText)
    setLocalToolResults({})
    setResumeInFlight(false)
  }

  // Preview locally submitted tools until the workspace refresh lands.
  const displayParts: Parts = parts.map((part) => {
    if (part.type !== "tool-invocation") return part
    if (
      !Object.prototype.hasOwnProperty.call(localToolResults, part.toolCallId)
    )
      return part
    if (part.state !== "input-available") return part
    return {
      ...part,
      state: "output-available" as const,
      output: localToolResults[part.toolCallId],
      errorText: undefined,
    }
  })

  const { appearance } = useWorkspaceChrome()
  const showIds = appearance.modelPicker.showIds
  const provider = providers.find((p) => p.id === metadata.provider)
  const providerName =
    provider?.name ??
    (typeof metadata.provider === "string" ? metadata.provider : "—")
  const modelName =
    typeof metadata.model === "string"
      ? (resolveModelLabel(
          parseProviderModelsJson(provider?.models_json ?? "[]"),
          metadata.model
        ) ?? metadata.model)
      : "—"

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
  const setContextExcludedMutation = useMutation(
    trpc.workspace.setContextExcluded.mutationOptions({
      onMutate: async (input) => {
        const key = trpc.workspace.get.queryKey({ chatId: node.chat_id })
        await queryClient.cancelQueries({ queryKey: key })
        const previous = queryClient.getQueryData<WorkspaceData>(key)
        queryClient.setQueryData(
          key,
          patchContextExcluded(previous, input.nodeId, input.excluded)
        )
        return { previous, key }
      },
      onError: (error, _input, context) => {
        if (context?.previous)
          queryClient.setQueryData(context.key, context.previous)
        toast.error(error.message || "Could not update message context")
      },
      onSettled: async (_data, _error, _input, context) => {
        if (context?.key)
          await queryClient.invalidateQueries({ queryKey: context.key })
      },
    })
  )
  const contextExclusionPending =
    setContextExcludedMutation.isPending &&
    setContextExcludedMutation.variables?.nodeId === node.id

  const copyMarkdown = async (kind: "message" | "path") => {
    const text =
      kind === "message"
        ? partsToMarkdown(displayParts)
        : pathToMarkdown(nodes, node.id)
    try {
      await copyText(text)
      toast.success(kind === "path" ? "Copied path" : "Copied")
    } catch {
      toast.error("Could not copy")
    }
  }

  const usage = metadata.usage
  const usageEntries =
    usage && typeof usage === "object" && !Array.isArray(usage)
      ? Object.entries(usage as Record<string, unknown>)
      : null

  return (
    <article
      data-theme-group={
        node.role === "user" ? "message-user" : "message-assistant"
      }
      data-theme-target={
        node.role === "user" ? "message-user" : "message-assistant"
      }
      className={cn(
        "group relative min-w-0 overflow-hidden rounded-xl border p-4",
        node.role === "user" && presentation === "linear"
          ? "ml-auto max-w-[88%] border-message-user-border bg-message-user text-message-user-foreground"
          : node.role === "user"
            ? "border-message-user-border bg-message-user text-message-user-foreground"
            : "border-message-assistant-border bg-message-assistant text-message-assistant-foreground"
      )}
    >
      <div className="mb-2 flex items-center justify-between text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <span>
          {node.role}
          {node.status === "awaiting_input"
            ? " · waiting for input"
            : node.status === "stopped"
              ? " · stopped"
              : node.status === "error"
                ? " · error"
                : null}
        </span>
        {presentation === "linear" && siblings.length > 1 && (
          <span className="flex items-center gap-1">
            <WithTooltip label="Previous branch">
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={index === 0}
                aria-label="Previous branch"
                onClick={() => {
                  const previous = siblings[index - 1]
                  if (previous) onSelect?.(node.parent_id ?? "", previous.id)
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
                  if (next) onSelect?.(node.parent_id ?? "", next.id)
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
      {displayParts.some((part) => part.type === "reasoning") ||
      displayParts.some((part) => part.type === "text") ||
      displayParts.some((part) => part.type === "attachment") ||
      displayParts.some((part) => part.type === "tool-invocation") ? (
        <MessageParts
          parts={displayParts}
          streaming={node.status === "streaming"}
          interactiveTools={interactiveTools && !resumeInFlight}
          onAnswerTool={
            onAnswerTools
              ? async (toolCallId, _toolName, output) => {
                  if (resumeInFlight) return
                  const next = {
                    ...localToolResults,
                    [toolCallId]: output,
                  }
                  setLocalToolResults(next)
                  if (!allPendingResultsReady(pendingIds, next)) return
                  setResumeInFlight(true)
                  try {
                    await onAnswerTools(
                      node.id,
                      pendingIds.map((id) => ({
                        toolCallId: id,
                        output: next[id],
                      }))
                    )
                  } catch {
                    setResumeInFlight(false)
                  }
                }
              : undefined
          }
        />
      ) : (
        <Markdown streaming={node.status === "streaming"}>
          {text || (node.status === "streaming" ? "Thinking…" : "")}
        </Markdown>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-0.5">
        <TooltipProvider delay={400}>
          <MessageAction
            onClick={() => void copyMarkdown("message")}
            icon={Copy01Icon}
            captions={messageActionCaptions}
          >
            Copy
          </MessageAction>
          {node.role === "assistant" && onRegenerate && (
            <MessageAction
              onClick={() => onRegenerate()}
              icon={RefreshIcon}
              captions={messageActionCaptions}
            >
              Regenerate
            </MessageAction>
          )}
          {canEditAsBranch && (
            <MessageAction
              onClick={() => {
                setEditText(editableText)
                setEditOpen(true)
              }}
              icon={Edit02Icon}
              captions={messageActionCaptions}
            >
              Edit as branch
            </MessageAction>
          )}
          <MessageAction
            onClick={() =>
              setContextExcludedMutation.mutate({
                nodeId: node.id,
                excluded: !node.excluded_from_context,
              })
            }
            icon={node.excluded_from_context ? ViewOffIcon : ViewIcon}
            captions={messageActionCaptions}
            disabled={contextExclusionPending}
          >
            {node.excluded_from_context
              ? "Include in context"
              : "Exclude from context"}
          </MessageAction>
          {node.role === "assistant" && Object.keys(metadata).length > 0 && (
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
          <DropdownMenu>
            <MoreActionsTrigger captions={messageActionCaptions} />
            <DropdownMenuContent
              align="end"
              side="top"
              className="max-w-[min(20rem,calc(100vw-1.5rem))]"
            >
              <DropdownMenuItem onClick={() => void copyMarkdown("path")}>
                <HugeiconsIcon
                  icon={GitBranchIcon}
                  strokeWidth={2}
                  className="size-3.5 text-muted-foreground"
                  aria-hidden
                />
                Copy path
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
              {modelName}
              {showIds &&
              typeof metadata.model === "string" &&
              modelName !== metadata.model ? (
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {metadata.model}
                </span>
              ) : null}
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
                  text: editText,
                  attachSelection: attachSelectionOnEdit,
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
              only works when there is exactly one child (promotes that child).
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
    </article>
  )
}
