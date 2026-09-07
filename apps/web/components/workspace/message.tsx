"use client"

import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowLeft01Icon,
  ArrowMoveUpRightIcon,
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
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { parseJson, subtreeNodeIds, textFromParts } from "@/lib/domain"
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
  canEditMessage,
  durableAuthoredParts,
  isEmptyParts,
  messagePartsSchema,
  pendingToolInvocations,
} from "@/lib/agent/parts"
import {
  authoredPartsFromSession,
  hasEditorSession,
  messageEditSlotId,
  sessionFromMessage,
  useConversationSessionStore,
  useEditorSession,
  useHasEditorSession,
  type ComposerAttachment,
} from "./conversation-session-store"
import { SessionMessageEditor } from "./message-editor"
import { useStreamBuffer, useStreamStore } from "@/lib/stream-store"
import { siblingSort } from "@/lib/sort-key"

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

export type MessageEditorBindings = {
  mcpAvailable: boolean
  animate: boolean
  onSend: (node: NodeRow) => Promise<boolean>
  onCancel: (node: NodeRow) => void
  onFinishEdit?: (node: NodeRow, mode: "sent" | "discard") => void
  onFiles: (slot: string, files: File[] | FileList) => void
  onRemoveAttachment: (slot: string, part: ComposerAttachment) => void
  onPreview: (src: string, name: string) => void
  onOpenResources: (slot: string) => void
  onOpenPrompts: (slot: string) => void
  onRevealContextMessage?: (nodeId: string) => void
}

export function Message({
  node,
  nodes,
  providers,
  messageActionCaptions,
  onSelect,
  onChanged,
  onRegenerate,
  onAnswerTools,
  presentation = "linear",
  attachSelectionOnEdit = true,
  editor,
  streamId = null,
}: {
  node: NodeRow
  nodes: NodeRow[]
  providers: ProviderSummary[]
  messageActionCaptions: boolean
  onSelect?: (parentId: string, childId: string) => void
  onChanged?: () => void | Promise<void>
  onRegenerate?: () => void
  onAnswerTools?: (
    assistantNodeId: string,
    toolResults: Array<{ toolCallId: string; output: unknown }>
  ) => void | Promise<void>
  /** Tree cards retain message actions but never mutate linear branch selection. */
  presentation?: "linear" | "tree"
  /** Tree edits create real branches without changing Linear's selected path. */
  attachSelectionOnEdit?: boolean
  editor?: MessageEditorBindings
  /** Live generation overlay; token text is read from the stream buffer. */
  streamId?: string | null
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const parts = parseJson<Parts>(node.parts_json, [])
  const streamBuffer = useStreamBuffer(streamId ?? "")
  const sourceParts = streamId ? streamBuffer.parts : parts
  const metadata = parseJson<Record<string, unknown>>(node.metadata_json, {})
  const text = textFromParts(sourceParts)
  const editSlot = messageEditSlotId(node.chat_id, node.id)
  const liveEdit = useHasEditorSession(editSlot)
  const editSession = useEditorSession(editSlot)
  const setSession = useConversationSessionStore((state) => state.setSession)
  const clearEdit = useConversationSessionStore((state) => state.clear)
  const shellRef = useRef<HTMLElement | null>(null)
  const setShellRef = (el: HTMLElement | null) => {
    shellRef.current = el
  }
  const wasEditingRef = useRef(liveEdit)
  useEffect(() => {
    const wasEditing = wasEditingRef.current
    wasEditingRef.current = liveEdit
    if (wasEditing && !liveEdit)
      shellRef.current?.focus({ preventScroll: true })
  }, [liveEdit])
  const editSourceParts =
    node.status === "streaming" || streamId
      ? durableAuthoredParts(sourceParts)
      : sourceParts
  const canEditAsBranch =
    canEditMessage(node.status, editSourceParts) &&
    !isEmptyParts(editSourceParts) &&
    (node.role === "assistant" || Boolean(editor))
  const interactiveTools =
    node.role === "assistant" &&
    node.status === "awaiting_input" &&
    Boolean(onAnswerTools)
  const pendingIds = pendingToolInvocations(sourceParts).map((p) => p.toolCallId)
  const siblings = nodes.filter(
    (candidate) =>
      candidate.parent_id === node.parent_id && candidate.role === node.role
  )
  siblings.sort(siblingSort)
  const index = siblings.findIndex((candidate) => candidate.id === node.id)
  const teleportBlocked = subtreeNodeIds(nodes, node.id)
  const teleportTargets = nodes.filter(
    (candidate) => !teleportBlocked.has(candidate.id)
  )
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [teleportOpen, setTeleportOpen] = useState(false)
  const [teleportDestination, setTeleportDestination] = useState("root")
  const [teleportSubtree, setTeleportSubtree] = useState(true)
  const [teleportMode, setTeleportMode] = useState<"reply" | "before">("reply")
  const [replaceOpen, setReplaceOpen] = useState(false)
  const moveRepliesId = useId()
  const dismissReplacement = () => {
    setReplaceOpen(false)
  }
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
    setDetailsOpen(false)
    setDeleteOpen(false)
    setTeleportOpen(false)
    setReplaceOpen(false)
    setTeleportMode("reply")
    setLocalToolResults({})
    setResumeInFlight(false)
  }

  // Preview locally submitted tools until the workspace refresh lands.
  const displayParts: Parts = sourceParts.map((part) => {
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
  const roleLayout =
    appearance.messageLayout[node.role === "user" ? "user" : "assistant"]
  const layoutStyle: CSSProperties | undefined =
    presentation === "tree"
      ? undefined
      : {
          maxWidth: `${roleLayout.maxWidthPercent}%`,
          marginLeft:
            roleLayout.align === "right"
              ? "auto"
              : roleLayout.align === "center"
                ? "auto"
                : undefined,
          marginRight:
            roleLayout.align === "left"
              ? "auto"
              : roleLayout.align === "center"
                ? "auto"
                : undefined,
        }
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

  const forkMessagePartsMutation = useMutation(
    trpc.workspace.forkMessageParts.mutationOptions({
      onSuccess: async () => {
        finishEdit("sent")
        await Promise.resolve(onChanged?.())
      },
      onError: (error) =>
        toast.error(error.message || "Could not save message branch"),
    })
  )
  const replaceMessageMutation = useMutation(
    trpc.workspace.replaceMessage.mutationOptions({
      onSuccess: async () => {
        dismissReplacement()
        finishEdit("sent")
        await Promise.resolve(onChanged?.())
      },
      onError: (error) =>
        toast.error(error.message || "Could not replace message"),
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
  const moveNodeMutation = useMutation(
    trpc.workspace.moveNode.mutationOptions({
      onSuccess: async () => {
        setTeleportOpen(false)
        await Promise.resolve(onChanged?.())
      },
      onError: (error) =>
        toast.error(error.message || "Could not move message"),
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
  const tree = presentation === "tree"
  const draftRole = editSession?.role ?? (node.role === "user" ? "user" : "assistant")
  const persistableParts = () => {
    const session = useConversationSessionStore.getState().sessions[editSlot]
    if (!session) return null
    const authored = authoredPartsFromSession(session)
    const next = durableAuthoredParts(authored.parts)
    const parsed = messagePartsSchema.safeParse(
      next.length > 0 ? next : [{ type: "text", text: "" }]
    )
    if (next.length > 0 && !parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid message")
      return null
    }
    if (isEmptyParts(next) && authored.attachments.length === 0) {
      toast.error("Message is required")
      return null
    }
    return {
      session,
      parts: next,
      attachments: authored.attachments,
    }
  }
  const finishEdit = (mode: "sent" | "discard") => {
    if (editor?.onFinishEdit) editor.onFinishEdit(node, mode)
    else clearEdit(editSlot)
  }
  const beginEdit = () => {
    if (hasEditorSession(editSlot)) return
    const latest = streamId
      ? (useStreamStore.getState().buffers[streamId]?.parts ?? parts)
      : parts
    const editParts =
      node.status === "streaming" || streamId
        ? durableAuthoredParts(latest)
        : latest
    if (isEmptyParts(editParts)) return
    setSession(
      editSlot,
      sessionFromMessage({
        role: node.role === "user" ? "user" : "assistant",
        parts: editParts,
      })
    )
  }
  const cancelEdit = () => {
    dismissReplacement()
    if (editor) editor.onCancel(node)
    else finishEdit("discard")
  }
  const saveEdit = () => {
    if (forkMessagePartsMutation.isPending) return
    const prepared = persistableParts()
    if (!prepared) return
    forkMessagePartsMutation.mutate({
      nodeId: node.id,
      parts: prepared.parts,
      attachments: prepared.attachments,
      role: prepared.session.role,
      attachSelection: attachSelectionOnEdit,
    })
  }
  const confirmReplace = () => {
    const prepared = persistableParts()
    if (!prepared) return
    if (streamId) useStreamStore.getState().stop(streamId)
    replaceMessageMutation.mutate({
      nodeId: node.id,
      parts: prepared.parts,
      attachments: prepared.attachments,
      role: prepared.session.role,
      expectedRevision: node.revision,
    })
  }

  const replacementDialog = (
    <AlertDialog
      open={replaceOpen}
      onOpenChange={(open) => {
        if (open) setReplaceOpen(true)
        else dismissReplacement()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Replace this message?</AlertDialogTitle>
          <AlertDialogDescription>
            This destructively replaces the current message. If it is still
            generating, generation stops and its current output is replaced.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirmReplace}
            disabled={replaceMessageMutation.isPending}
          >
            Replace message
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  if (liveEdit && (draftRole !== "user" || editor)) {
    return (
      <>
        <div
          ref={setShellRef}
          tabIndex={-1}
          data-find-node={node.id}
          className={
            presentation === "linear" && draftRole === "user"
              ? "w-full"
              : undefined
          }
          style={layoutStyle}
        >
          <SessionMessageEditor
            slot={editSlot}
            variant="inline"
            purpose="edit"
            placement={presentation === "tree" ? "tree" : "linear"}
            autoFocus
            animate={editor?.animate}
            placeholder="Edit this message…"
            sendLabel={
              draftRole === "user" ? "Save & generate" : "Save branch"
            }
            mcpAvailable={Boolean(editor?.mcpAvailable) && draftRole === "user"}
            allowAttachments={draftRole === "user"}
            showContextPreview
            contextParentId={node.parent_id}
            overlayNodeId={node.id}
            submitting={
              draftRole === "user"
                ? undefined
                : forkMessagePartsMutation.isPending
            }
            onSend={() => {
              if (draftRole === "user") {
                void editor?.onSend(node)
                return
              }
              saveEdit()
            }}
            onCancel={cancelEdit}
            onReplace={() => setReplaceOpen(true)}
            onFiles={
              editor ? (files) => editor.onFiles(editSlot, files) : undefined
            }
            onRemoveAttachment={
              editor
                ? (part) => editor.onRemoveAttachment(editSlot, part)
                : undefined
            }
            onPreview={editor?.onPreview}
            onOpenResources={
              editor ? () => editor.onOpenResources(editSlot) : undefined
            }
            onOpenPrompts={
              editor ? () => editor.onOpenPrompts(editSlot) : undefined
            }
            onRevealContextMessage={editor?.onRevealContextMessage}
          />
        </div>
        {replacementDialog}
      </>
    )
  }

  return (
    <article
      ref={setShellRef}
      tabIndex={-1}
      data-find-node={node.id}
      {...(node.status === "streaming" || streamId
        ? { "data-find-skip": "" }
        : {})}
      {...(tree && streamId ? { "data-tree-streaming": "" } : {})}
      data-theme-group={
        node.role === "user" ? "message-user" : "message-assistant"
      }
      data-theme-target={
        node.role === "user" ? "message-user" : "message-assistant"
      }
      className={cn(
        "group relative min-w-0 rounded-xl border",
        tree
          ? "flex h-full min-h-0 flex-col overflow-hidden"
          : "overflow-hidden p-4",
        node.role === "user" && presentation === "linear"
          ? "border-message-user-border bg-message-user text-message-user-foreground"
          : node.role === "user"
            ? "border-message-user-border bg-message-user text-message-user-foreground"
            : "border-message-assistant-border bg-message-assistant text-message-assistant-foreground",
        tree && "hover:border-foreground/30"
      )}
      style={layoutStyle}
    >
      <div
        className={
          tree
            ? cn(
                "overscroll-contain px-4 pt-3.5 pb-2",
                "min-h-0 flex-1 overflow-y-auto"
              )
            : undefined
        }
        data-tree-scroll={tree ? "" : undefined}
      >
        {presentation === "linear" ? (
          <div
            data-find-skip
            className="mb-2 flex items-center justify-between text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
          >
            <span>
              {node.role}
              {node.status === "awaiting_input"
                ? " · waiting for input"
                : node.status === "streaming" || streamId
                  ? " · streaming"
                  : node.status === "stopped"
                    ? " · stopped"
                    : node.status === "error"
                      ? " · error"
                      : null}
            </span>
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
                      if (previous)
                        onSelect?.(node.parent_id ?? "", previous.id)
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
        ) : node.status !== "complete" && node.status !== "streaming" ? (
          <p
            data-find-skip
            className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground"
          >
            {node.status === "awaiting_input"
              ? "waiting for input"
              : node.status}
          </p>
        ) : null}
        {displayParts.some((part) => part.type === "reasoning") ||
        displayParts.some((part) => part.type === "text") ||
        displayParts.some((part) => part.type === "attachment") ||
        displayParts.some((part) => part.type === "tool-invocation") ? (
          <MessageParts
            parts={displayParts}
            streaming={node.status === "streaming" || Boolean(streamId)}
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
          <Markdown streaming={node.status === "streaming" || Boolean(streamId)}>
            {text ||
              (node.status === "streaming" || streamId ? "Thinking…" : "")}
          </Markdown>
        )}
        {tree && node.status === "error" ? (
          <p className="mt-2 text-xs break-words text-destructive">
            {typeof metadata.error === "string" && metadata.error
              ? metadata.error
              : "This response did not complete."}
          </p>
        ) : null}
      </div>
      <div
        data-find-skip
        className={cn(
          "flex flex-wrap items-center gap-0.5",
          tree ? "shrink-0 border-t border-foreground/8 px-2 py-1" : "mt-3"
        )}
      >
        <TooltipProvider delay={400}>
          <MessageAction
            onClick={() => void copyMarkdown("message")}
            icon={Copy01Icon}
            captions={messageActionCaptions}
          >
            Copy
          </MessageAction>
          {node.role === "assistant" &&
            onRegenerate &&
            node.status !== "streaming" &&
            !streamId && (
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
              onClick={beginEdit}
              icon={Edit02Icon}
              captions={messageActionCaptions}
            >
              Edit
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
              <DropdownMenuItem onClick={() => setTeleportOpen(true)}>
                <HugeiconsIcon
                  icon={ArrowMoveUpRightIcon}
                  strokeWidth={2}
                  className="size-3.5 text-muted-foreground"
                  aria-hidden
                />
                Move…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TooltipProvider>
      </div>
      {!tree && node.status === "error" && (
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

      <Dialog open={teleportOpen} onOpenChange={setTeleportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move message</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Reattach this message in the conversation. Leaving replies behind
            promotes them to this message&apos;s former parent.
          </p>
          <div className="grid gap-1.5">
            <Label id="move-placement">Placement</Label>
            <ToggleGroup
              value={[teleportMode]}
              onValueChange={(next) => {
                const mode = next[0]
                if (mode === "reply" || mode === "before") setTeleportMode(mode)
              }}
              variant="outline"
              spacing={0}
              size="sm"
              className="w-full"
              aria-labelledby="move-placement"
            >
              <ToggleGroupItem value="reply" className="flex-1">
                As a reply
              </ToggleGroupItem>
              <ToggleGroupItem
                value="before"
                className="flex-1"
                disabled={teleportDestination === "root"}
              >
                Before this message
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <Label className="grid gap-1.5 text-sm">
            {teleportMode === "before" ? "Insert before" : "Reply to"}
            <Select
              value={teleportDestination}
              onValueChange={(value) => {
                if (!value) return
                setTeleportDestination(value)
                if (value === "root") setTeleportMode("reply")
              }}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="root">Conversation root</SelectItem>
                {teleportTargets.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.role}:{" "}
                    {textFromParts(
                      parseJson<Parts>(candidate.parts_json, [])
                    ).slice(0, 72) || "(empty)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <div className="flex items-center gap-2">
            <Switch
              id={moveRepliesId}
              checked={teleportSubtree}
              onCheckedChange={(checked) =>
                setTeleportSubtree(checked === true)
              }
            />
            <Label htmlFor={moveRepliesId} className="text-sm font-normal">
              Also move replies
            </Label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTeleportOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={moveNodeMutation.isPending}
              onClick={() =>
                moveNodeMutation.mutate({
                  nodeId: node.id,
                  destinationParentId:
                    teleportDestination === "root" ? null : teleportDestination,
                  ...(teleportMode === "before" &&
                  teleportDestination !== "root"
                    ? { beforeNodeId: teleportDestination }
                    : {}),
                  subtree: teleportSubtree,
                })
              }
            >
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete message node</AlertDialogTitle>
            <AlertDialogDescription>
              Subtree delete removes this node and all descendants. Keep replies
              removes only this message and promotes every direct reply.
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
              Keep replies
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
      {replacementDialog}
    </article>
  )
}
