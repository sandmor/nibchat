"use client"

import {
  Fragment,
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react"
import { toast } from "sonner"
import { expandPromptMacros, type MacroContext } from "@/lib/prompt-macros"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowMoveUpRightIcon,
  Clock01Icon,
  Copy01Icon,
  GitBranchIcon,
  MoreHorizontalIcon,
  Refresh01Icon,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MessageShell } from "./message-shell"
import { cn } from "@/lib/utils"
import { copyText } from "@/lib/clipboard"
import { partsToMarkdown, pathToMarkdown } from "@/lib/message-markdown"
import type { NodeRow, Parts } from "@/lib/types"
import { parseJson, subtreeNodeIds, textFromParts } from "@/lib/domain"
import { Markdown } from "@/components/markdown"
import type { ProviderSummary } from "./types"
import { LongBlockFrame } from "./long-block-nav"
import { MessageParts } from "./message-parts"
import { useWorkspaceChrome } from "./shell"
import {
  allPendingResultsReady,
  canEditMessage,
  durableAuthoredParts,
  isEmptyParts,
  messagePartsSchema,
  pendingToolInvocations,
  retainedClientToolResults,
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
import { overlayStreamParts } from "./stream-helpers"
import { siblingSort } from "@/lib/sort-key"
import { MultipleGenerationsDialog } from "./generation-count"
import {
  effectiveMessageStatus,
  formatGenerationDuration,
  formatMessageTime,
  generationDurationMs,
  joinMessageMeta,
  messageOriginLabel,
  messageStatusLabel,
  resolveMessageOrigin,
} from "@/lib/message-meta"
import {
  MESSAGE_FOOTER_ACTION,
  prepareMessageFooterHtml,
} from "@/lib/message-footer-html"
import {
  useMessageMutationController,
  type MessageMutationOperation,
} from "./message-mutations"
import {
  scheduledGenerationMenuLabel,
  useScheduledGeneration,
} from "./scheduled-generation"

type MessageDialog = "details" | "delete" | "move" | "replace" | "multiple"
type MountedMessageDialogs = Record<MessageDialog, boolean>

const NO_MOUNTED_MESSAGE_DIALOGS: MountedMessageDialogs = {
  details: false,
  delete: false,
  move: false,
  replace: false,
  multiple: false,
}
const NO_PENDING_TOOL_IDS: string[] = []

function messageActionClass(captions: boolean) {
  return cn(
    captions
      ? "h-7 gap-1 px-2 text-xs font-normal"
      : "size-7 text-muted-foreground hover:text-foreground"
  )
}

function MoreActionsTrigger({ captions }: { captions: boolean }) {
  return (
    <DropdownMenuTrigger
      render={
        <Button
          type="button"
          variant="ghost"
          size={captions ? "xs" : "icon-xs"}
          className={messageActionClass(captions)}
          aria-label="More"
          {...(captions
            ? {}
            : {
                "data-static-tooltip": "More",
                "data-static-tooltip-gap": "4",
              })}
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
}

function applyLocalToolResults(
  sourceParts: Parts,
  toolResults: Record<string, unknown>
): Parts {
  if (Object.keys(toolResults).length === 0) return sourceParts
  return sourceParts.map((part) => {
    if (part.type !== "tool-invocation") return part
    if (!Object.prototype.hasOwnProperty.call(toolResults, part.toolCallId))
      return part
    if (part.state !== "input-available") return part
    return {
      ...part,
      state: "output-available" as const,
      output: toolResults[part.toolCallId],
      errorText: undefined,
    }
  })
}

function overlayFor(
  persistedParts: Parts,
  streamId: string | null | undefined
) {
  return overlayStreamParts(
    persistedParts,
    streamId ? (useStreamStore.getState().buffers[streamId]?.parts ?? []) : [],
    streamId
  )
}

/** Token text only. Message chrome must not subscribe to the live buffer. */
function MessageLiveBody({
  persistedParts,
  streamId,
  streaming,
  interactiveTools,
  toolResults,
  onAnswerTool,
  macroContext,
}: {
  persistedParts: Parts
  streamId: string | null | undefined
  streaming: boolean
  interactiveTools: boolean
  toolResults: Record<string, unknown>
  onAnswerTool?: (
    toolCallId: string,
    toolName: string,
    output: unknown
  ) => void | Promise<void>
  macroContext?: MacroContext
}) {
  const streamBuffer = useStreamBuffer(streamId ?? "")
  const sourceParts = overlayStreamParts(
    persistedParts,
    streamBuffer.parts,
    streamId
  )
  const displayParts = applyLocalToolResults(sourceParts, toolResults).map(
    (part) =>
      part.type === "text" && macroContext
        ? { ...part, text: expandPromptMacros(part.text, macroContext) }
        : part
  )
  const hasStructuredBody = displayParts.some(
    (part) =>
      part.type === "reasoning" ||
      part.type === "text" ||
      part.type === "attachment" ||
      part.type === "tool-invocation"
  )
  if (hasStructuredBody) {
    return (
      <MessageParts
        parts={displayParts}
        streaming={streaming}
        interactiveTools={interactiveTools}
        onAnswerTool={onAnswerTool}
      />
    )
  }
  return (
    <Markdown streaming={streaming}>
      {textFromParts(displayParts) || (streaming ? "Thinking…" : "")}
    </Markdown>
  )
}

function useCanEditAsBranch(
  node: NodeRow,
  persistedParts: Parts,
  streamId: string | null | undefined,
  allowUserEdit: boolean
) {
  return useStreamStore((state) => {
    const overlay = overlayStreamParts(
      persistedParts,
      streamId ? (state.buffers[streamId]?.parts ?? []) : [],
      streamId
    )
    const editParts =
      node.status === "streaming" || streamId
        ? durableAuthoredParts(overlay)
        : overlay
    return (
      canEditMessage(node.status, editParts) &&
      !isEmptyParts(editParts) &&
      (node.role === "assistant" || allowUserEdit)
    )
  })
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

type MessageProps = {
  node: NodeRow
  nodes: NodeRow[]
  /** Precomputed in linear view; tree callers fall back to local grouping. */
  siblingNodes?: readonly NodeRow[]
  providers: ProviderSummary[]
  messageActionCaptions: boolean
  onSelect?: (parentId: string, childId: string) => void
  onChanged?: () => void | Promise<void>
  onGenerateReplies?: (count?: number) => void
  /** New sibling of this assistant, parented where this message already sits. */
  onRegenerate?: (count?: number) => void
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
}

/** Skip handler identity, parents rebuild those on unrelated ChatView updates. */
function messagePropsAreEqual(prev: MessageProps, next: MessageProps) {
  return (
    prev.node === next.node &&
    prev.nodes === next.nodes &&
    prev.siblingNodes === next.siblingNodes &&
    prev.providers === next.providers &&
    prev.messageActionCaptions === next.messageActionCaptions &&
    prev.presentation === next.presentation &&
    prev.attachSelectionOnEdit === next.attachSelectionOnEdit &&
    (prev.streamId ?? null) === (next.streamId ?? null) &&
    prev.editor?.mcpAvailable === next.editor?.mcpAvailable &&
    prev.editor?.animate === next.editor?.animate
  )
}

export const Message = memo(function Message({
  node,
  nodes,
  siblingNodes,
  providers,
  messageActionCaptions,
  onSelect,
  onChanged,
  onGenerateReplies,
  onRegenerate,
  onAnswerTools,
  presentation = "linear",
  attachSelectionOnEdit = true,
  editor,
  streamId = null,
}: MessageProps) {
  const { execute: executeMessageMutation } = useMessageMutationController()
  const parts = useMemo(
    () => parseJson<Parts>(node.parts_json, []),
    [node.parts_json]
  )
  const metadata = useMemo(
    () => parseJson<Record<string, unknown>>(node.metadata_json, {}),
    [node.metadata_json]
  )
  const literalParts = useMemo(() => {
    if (!Array.isArray(metadata.literalParts)) return null
    const parsed = messagePartsSchema.safeParse(metadata.literalParts)
    return parsed.success ? parsed.data : null
  }, [metadata.literalParts])
  const liveMacroContext = useMemo<MacroContext | undefined>(() => {
    const value = metadata.liveMacroContext
    if (!value || typeof value !== "object") return undefined
    const raw = value as Record<string, unknown>
    if (typeof raw.now !== "string" || typeof raw.timeZone !== "string")
      return undefined
    const chat = raw.chat as Record<string, unknown> | undefined
    return {
      now: new Date(raw.now),
      timeZone: raw.timeZone,
      ...(chat &&
      typeof chat.id === "string" &&
      typeof chat.createdAt === "string"
        ? {
            chat: { id: chat.id, createdAt: new Date(chat.createdAt) },
          }
        : {}),
      ...(raw.variables && typeof raw.variables === "object"
        ? { variables: raw.variables as Record<string, string | boolean> }
        : {}),
      ...(raw.contextEntries && typeof raw.contextEntries === "object"
        ? { contextEntries: raw.contextEntries as Record<string, string> }
        : {}),
    }
  }, [metadata.liveMacroContext])
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
  const canEditAsBranch = useCanEditAsBranch(
    node,
    parts,
    streamId,
    Boolean(editor)
  )
  const pendingIds =
    node.status === "awaiting_input"
      ? pendingToolInvocations(parts).map((part) => part.toolCallId)
      : NO_PENDING_TOOL_IDS
  const siblings = useMemo(
    () =>
      siblingNodes ??
      nodes
        .filter(
          (candidate) =>
            candidate.parent_id === node.parent_id &&
            candidate.role === node.role
        )
        .sort(siblingSort),
    [node.parent_id, node.role, nodes, siblingNodes]
  )
  const generatingChildren = nodes.filter(
    (candidate) =>
      candidate.parent_id === node.id &&
      candidate.role === "assistant" &&
      candidate.status === "streaming"
  ).length
  const index = siblings.findIndex((candidate) => candidate.id === node.id)
  const onlyChild = !nodes.some(
    (candidate) =>
      candidate.id !== node.id && candidate.parent_id === node.parent_id
  )
  const hasReplies = nodes.some((candidate) => candidate.parent_id === node.id)
  const showKeepReplies = onlyChild && hasReplies
  const showDeleteSiblings = siblings.length > 1
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [multipleOpen, setMultipleOpen] = useState(false)
  const [multipleMode, setMultipleMode] = useState<"replies" | "regenerate">(
    "replies"
  )
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [teleportOpen, setTeleportOpen] = useState(false)
  const teleportTargets = useMemo(() => {
    if (!teleportOpen) return []
    const blocked = subtreeNodeIds(nodes, node.id)
    return nodes.filter((candidate) => !blocked.has(candidate.id))
  }, [teleportOpen, nodes, node.id])
  const [teleportDestination, setTeleportDestination] = useState("root")
  const [teleportSubtree, setTeleportSubtree] = useState(true)
  const [teleportMode, setTeleportMode] = useState<"reply" | "before">("reply")
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [mountedDialogs, setMountedDialogs] = useState<MountedMessageDialogs>(
    NO_MOUNTED_MESSAGE_DIALOGS
  )
  const openDialog = (
    dialog: MessageDialog,
    setOpen: (open: boolean) => void
  ) => {
    setMountedDialogs((current) =>
      current[dialog] ? current : { ...current, [dialog]: true }
    )
    setOpen(true)
  }
  const moveRepliesId = useId()
  const dismissReplacement = () => {
    setReplaceOpen(false)
  }
  /** Local answers for the current awaiting_input checkpoint. */
  const [localToolResults, setLocalToolResults] = useState<
    Record<string, unknown>
  >({})
  const resumeInFlightRef = useRef(false)
  // Path slots reuse this instance across sibling switches. Reset UI when the
  // bound node identity changes (render-time adjust; keep article shell mounted).
  const [boundNodeId, setBoundNodeId] = useState(node.id)
  let toolResults = localToolResults
  if (node.id !== boundNodeId) {
    setBoundNodeId(node.id)
    setDetailsOpen(false)
    setDeleteOpen(false)
    setTeleportOpen(false)
    setReplaceOpen(false)
    setMountedDialogs(NO_MOUNTED_MESSAGE_DIALOGS)
    setTeleportMode("reply")
    toolResults = {}
    setLocalToolResults({})
  } else {
    const nextResults = retainedClientToolResults(
      localToolResults,
      node.status,
      pendingIds
    )
    if (nextResults !== localToolResults) {
      toolResults = nextResults
      setLocalToolResults(nextResults)
    }
  }
  const answersHeld = allPendingResultsReady(pendingIds, toolResults)
  useEffect(() => {
    if (node.status !== "awaiting_input" || !answersHeld)
      resumeInFlightRef.current = false
  }, [answersHeld, node.id, node.status])
  const interactiveTools =
    node.role === "assistant" &&
    node.status === "awaiting_input" &&
    Boolean(onAnswerTools) &&
    !answersHeld

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
  const origin = resolveMessageOrigin(metadata, providers)
  const originLabel = messageOriginLabel(origin)
  const createdTime = formatMessageTime(node.created_at)
  const identityLabel = joinMessageMeta(createdTime?.compact, originLabel)
  const generationMs = generationDurationMs(metadata)
  const generationLabel =
    generationMs == null ? null : formatGenerationDuration(generationMs)
  const liveStream = Boolean(streamId)
  const displayStatus = effectiveMessageStatus(node.status, liveStream)
  const statusLabel = messageStatusLabel(displayStatus)
  const hasDetails =
    node.role === "assistant" &&
    (Boolean(originLabel) || Object.keys(metadata).length > 0)

  const [pendingMutation, setPendingMutation] = useState<
    MessageMutationOperation["kind"] | null
  >(null)
  const contextExclusionPending = pendingMutation === "context"

  const copyMarkdown = async (kind: "message" | "path") => {
    const text =
      kind === "message"
        ? partsToMarkdown(
            applyLocalToolResults(overlayFor(parts, streamId), toolResults)
          )
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
  const draftRole =
    editSession?.role ?? (node.role === "user" ? "user" : "assistant")
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
  const runMessageMutation = async (
    operation: MessageMutationOperation,
    onSuccess?: () => void | Promise<void>
  ) => {
    if (pendingMutation) return false
    setPendingMutation(operation.kind)
    try {
      await executeMessageMutation(operation)
      await onSuccess?.()
      return true
    } catch {
      // The shared controller reports and rolls back the operation.
      return false
    } finally {
      setPendingMutation(null)
    }
  }
  const beginEdit = () => {
    if (hasEditorSession(editSlot)) return
    const latest = overlayFor(literalParts ?? parts, streamId)
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
    if (pendingMutation) return
    const prepared = persistableParts()
    if (!prepared) return
    void runMessageMutation(
      {
        kind: "fork",
        input: {
          nodeId: node.id,
          parts: prepared.parts,
          attachments: prepared.attachments,
          role: prepared.session.role,
          attachSelection: attachSelectionOnEdit,
        },
      },
      async () => {
        finishEdit("sent")
        await Promise.resolve(onChanged?.())
      }
    )
  }
  const confirmReplace = () => {
    const prepared = persistableParts()
    if (!prepared) return
    if (streamId) useStreamStore.getState().stop(streamId)
    void runMessageMutation(
      {
        kind: "replace",
        input: {
          nodeId: node.id,
          parts: prepared.parts,
          attachments: prepared.attachments,
          role: prepared.session.role,
          expectedRevision: node.revision,
        },
      },
      async () => {
        dismissReplacement()
        finishEdit("sent")
        await Promise.resolve(onChanged?.())
      }
    )
  }

  const scheduledGeneration = useScheduledGeneration()
  const scheduleMenu =
    scheduledGeneration?.available && node.role === "user"
      ? (() => {
          return {
            label: scheduledGenerationMenuLabel(),
            onOpen: () => scheduledGeneration.openForNode(node.id),
          }
        })()
      : null

  const generationIdle =
    node.status !== "streaming" &&
    node.status !== "awaiting_input" &&
    !streamId
  const canGenerateReplies = Boolean(onGenerateReplies) && generationIdle
  const canRegenerate =
    node.role === "assistant" && Boolean(onRegenerate) && generationIdle

  const footerHtml = prepareMessageFooterHtml({
    captions: messageActionCaptions,
    contextExcluded: node.excluded_from_context,
    contextPending: contextExclusionPending,
    identity: {
      label: identityLabel,
      title: hasDetails
        ? joinMessageMeta(createdTime?.full, originLabel)
        : (createdTime?.full ?? identityLabel),
      hasDetails,
      createdTime: createdTime?.compact ?? null,
      providerName: origin.providerName ?? null,
      modelName: origin.modelName ?? null,
    },
    showDetailsAction: hasDetails && !identityLabel,
    showEdit: canEditAsBranch,
    generate: canRegenerate
      ? "regenerate"
      : canGenerateReplies && node.role === "user"
        ? "answer"
        : null,
    siblingCount: presentation === "linear" ? siblings.length : 0,
    siblingIndex: index,
  })

  const onFooterAction = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const actionElement = target.closest<HTMLElement>(
      "[data-message-footer-action]"
    )
    const action = actionElement?.dataset.messageFooterAction
    if (!action || !actionElement) return
    event.preventDefault()

    if (action === MESSAGE_FOOTER_ACTION.copy) {
      void copyMarkdown("message")
    } else if (action === MESSAGE_FOOTER_ACTION.generate) {
      if (node.role === "assistant") onRegenerate?.()
      else onGenerateReplies?.()
    } else if (action === MESSAGE_FOOTER_ACTION.edit) {
      beginEdit()
    } else if (action === MESSAGE_FOOTER_ACTION.toggleContext) {
      void runMessageMutation({
        kind: "context",
        chatId: node.chat_id,
        input: {
          nodeId: node.id,
          excluded: !node.excluded_from_context,
        },
      })
    } else if (action === MESSAGE_FOOTER_ACTION.details) {
      openDialog("details", setDetailsOpen)
    } else if (action === MESSAGE_FOOTER_ACTION.delete) {
      openDialog("delete", setDeleteOpen)
    } else if (action === MESSAGE_FOOTER_ACTION.previousSibling) {
      const previous = siblings[index - 1]
      if (previous) onSelect?.(node.parent_id ?? "", previous.id)
    } else if (action === MESSAGE_FOOTER_ACTION.nextSibling) {
      const next = siblings[index + 1]
      if (next) onSelect?.(node.parent_id ?? "", next.id)
    }
  }

  const replacementDialog = mountedDialogs.replace ? (
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
            disabled={pendingMutation === "replace"}
          >
            Replace message
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null

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
            sendLabel={draftRole === "user" ? "Save & generate" : "Save branch"}
            mcpAvailable={Boolean(editor?.mcpAvailable) && draftRole === "user"}
            allowAttachments={draftRole === "user"}
            showContextPreview
            contextParentId={node.parent_id}
            overlayNodeId={node.id}
            submitting={
              draftRole === "user" ? undefined : pendingMutation === "fork"
            }
            onSend={() => {
              if (editor) {
                void editor?.onSend(node)
                return
              }
              saveEdit()
            }}
            onCancel={cancelEdit}
            onReplace={() => openDialog("replace", setReplaceOpen)}
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

  const article = (
    <MessageShell
      ref={setShellRef}
      role={node.role === "user" ? "user" : "assistant"}
      tree={Boolean(tree)}
      layout={presentation === "linear" ? roleLayout : undefined}
      tabIndex={-1}
      data-find-node={node.id}
      {...(node.status === "streaming" || streamId
        ? { "data-find-skip": "" }
        : {})}
      {...(tree && streamId ? { "data-tree-streaming": "" } : {})}
      data-message-status={displayStatus}
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
        {statusLabel ? (
          <p
            data-find-skip
            className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground"
          >
            {statusLabel}
          </p>
        ) : null}
        <MessageLiveBody
          persistedParts={literalParts ?? parts}
          streamId={streamId}
          streaming={node.status === "streaming" || Boolean(streamId)}
          interactiveTools={interactiveTools}
          toolResults={toolResults}
          macroContext={liveMacroContext}
          onAnswerTool={
            onAnswerTools
              ? async (toolCallId, _toolName, output) => {
                  if (resumeInFlightRef.current || answersHeld) return
                  const next = {
                    ...toolResults,
                    [toolCallId]: output,
                  }
                  setLocalToolResults(next)
                  if (!allPendingResultsReady(pendingIds, next)) return
                  resumeInFlightRef.current = true
                  try {
                    await onAnswerTools(
                      node.id,
                      pendingIds.map((id) => ({
                        toolCallId: id,
                        output: next[id],
                      }))
                    )
                  } catch {
                    resumeInFlightRef.current = false
                    setLocalToolResults({})
                  }
                }
              : undefined
          }
        />
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
        data-message-footer=""
        onClick={onFooterAction}
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-1",
          tree ? "shrink-0 border-t border-foreground/8 px-2 py-1" : "mt-3"
        )}
      >
        <span
          className="contents"
          data-message-footer-html="identity"
          dangerouslySetInnerHTML={footerHtml.identity}
        />
        {generatingChildren > 1 ? (
          <span className="text-[11px] text-muted-foreground">
            {generatingChildren} replies generating
          </span>
        ) : null}
        <span className="flex flex-wrap items-center gap-0.5">
          <span
            className="contents"
            data-message-footer-html="actions"
            dangerouslySetInnerHTML={footerHtml.actions}
          />
          <DropdownMenu>
            <MoreActionsTrigger captions={messageActionCaptions} />
            <DropdownMenuContent
              align="end"
              side="top"
              className="max-w-[min(20rem,calc(100vw-1.5rem))]"
            >
              {canRegenerate ? (
                <DropdownMenuItem
                  onClick={() => {
                    setMultipleMode("regenerate")
                    openDialog("multiple", setMultipleOpen)
                  }}
                >
                  <HugeiconsIcon
                    icon={Refresh01Icon}
                    strokeWidth={2}
                    className="size-3.5 text-muted-foreground"
                    aria-hidden
                  />
                  Regenerate several…
                </DropdownMenuItem>
              ) : null}
              {canGenerateReplies ? (
                <DropdownMenuItem
                  onClick={() => {
                    setMultipleMode("replies")
                    openDialog("multiple", setMultipleOpen)
                  }}
                >
                  <HugeiconsIcon
                    icon={GitBranchIcon}
                    strokeWidth={2}
                    className="size-3.5 text-muted-foreground"
                    aria-hidden
                  />
                  Generate replies…
                </DropdownMenuItem>
              ) : null}
              {scheduleMenu ? (
                <DropdownMenuItem onClick={scheduleMenu.onOpen}>
                  <HugeiconsIcon
                    icon={Clock01Icon}
                    strokeWidth={2}
                    className="size-3.5 text-muted-foreground"
                    aria-hidden
                  />
                  {scheduleMenu.label}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => void copyMarkdown("path")}>
                <HugeiconsIcon
                  icon={Copy01Icon}
                  strokeWidth={2}
                  className="size-3.5 text-muted-foreground"
                  aria-hidden
                />
                Copy path
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => openDialog("move", setTeleportOpen)}
              >
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
        </span>
      </div>
      {mountedDialogs.multiple ? (
        <MultipleGenerationsDialog
          open={multipleOpen}
          onOpenChange={setMultipleOpen}
          verb={multipleMode === "regenerate" ? "Regenerate" : "Generate"}
          onConfirm={(count) =>
            multipleMode === "regenerate"
              ? onRegenerate?.(count)
              : onGenerateReplies?.(count)
          }
        />
      ) : null}
      {!tree && node.status === "error" && (
        <p className="mt-3 text-xs break-words text-destructive">
          {typeof metadata.error === "string" && metadata.error
            ? metadata.error
            : "This response did not complete."}
        </p>
      )}

      {mountedDialogs.details ? (
        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Message details</DialogTitle>
            </DialogHeader>
            <dl className="grid min-w-0 grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {createdTime ? (
                <>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd className="min-w-0 break-all">{createdTime.full}</dd>
                </>
              ) : null}
              {origin.providerName ? (
                <>
                  <dt className="text-muted-foreground">Provider</dt>
                  <dd className="min-w-0 break-all">
                    {origin.providerName}
                    {showIds &&
                    origin.providerId &&
                    origin.providerName !== origin.providerId ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {origin.providerId}
                      </span>
                    ) : null}
                  </dd>
                </>
              ) : null}
              {origin.modelName ? (
                <>
                  <dt className="text-muted-foreground">Model</dt>
                  <dd className="min-w-0 break-all">
                    {origin.modelName}
                    {showIds &&
                    origin.modelId &&
                    origin.modelName !== origin.modelId ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {origin.modelId}
                      </span>
                    ) : null}
                  </dd>
                </>
              ) : null}
              {generationLabel ? (
                <>
                  <dt className="text-muted-foreground">Duration</dt>
                  <dd className="min-w-0 break-all">{generationLabel}</dd>
                </>
              ) : null}
              {metadata.finishReason != null && (
                <>
                  <dt className="text-muted-foreground">Finish</dt>
                  <dd className="min-w-0 break-all">
                    {String(metadata.finishReason)}
                  </dd>
                </>
              )}
              {metadata.finishedAt != null && (
                <>
                  <dt className="text-muted-foreground">Finished</dt>
                  <dd className="min-w-0 break-all">
                    {typeof metadata.finishedAt === "string"
                      ? (formatMessageTime(metadata.finishedAt)?.full ??
                        metadata.finishedAt)
                      : String(metadata.finishedAt)}
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
            {usageEntries && usageEntries.length > 0 ? (
              <div className="min-w-0">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Usage
                </p>
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
              </div>
            ) : usage ? (
              <div className="min-w-0">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Usage
                </p>
                <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-2 font-mono text-xs break-all whitespace-pre-wrap">
                  {JSON.stringify(usage, null, 2)}
                </pre>
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDetailsOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {mountedDialogs.move ? (
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
                  if (mode === "reply" || mode === "before")
                    setTeleportMode(mode)
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
                disabled={pendingMutation === "move"}
                onClick={() =>
                  void runMessageMutation(
                    {
                      kind: "move",
                      input: {
                        nodeId: node.id,
                        destinationParentId:
                          teleportDestination === "root"
                            ? null
                            : teleportDestination,
                        ...(teleportMode === "before" &&
                        teleportDestination !== "root"
                          ? { beforeNodeId: teleportDestination }
                          : {}),
                        subtree: teleportSubtree,
                      },
                    },
                    async () => {
                      setTeleportOpen(false)
                      await Promise.resolve(onChanged?.())
                    }
                  )
                }
              >
                Move
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {mountedDialogs.delete ? (
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete message node</AlertDialogTitle>
              <AlertDialogDescription>
                {[
                  "Delete subtree removes this message and everything under it.",
                  showKeepReplies
                    ? "Keep replies removes only this message and promotes its replies."
                    : "",
                  showDeleteSiblings
                    ? "Delete all versions removes this message, the other versions beside it, and everything under them."
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              {showKeepReplies ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    void runMessageMutation(
                      {
                        kind: "delete",
                        input: {
                          nodeId: node.id,
                          mode: "reparent",
                        },
                      },
                      async () => {
                        setDeleteOpen(false)
                        await Promise.resolve(onChanged?.())
                      }
                    )
                  }
                >
                  Keep replies
                </Button>
              ) : null}
              <AlertDialogAction
                variant="destructive"
                onClick={() =>
                  void runMessageMutation(
                    {
                      kind: "delete",
                      input: {
                        nodeId: node.id,
                        mode: "subtree",
                      },
                    },
                    async () => {
                      setDeleteOpen(false)
                      await Promise.resolve(onChanged?.())
                    }
                  )
                }
              >
                Delete subtree
              </AlertDialogAction>
              {showDeleteSiblings ? (
                <Button
                  variant="destructive"
                  onClick={() =>
                    void runMessageMutation(
                      {
                        kind: "delete",
                        input: {
                          nodeId: node.id,
                          mode: "siblings",
                        },
                      },
                      async () => {
                        setDeleteOpen(false)
                        await Promise.resolve(onChanged?.())
                      }
                    )
                  }
                >
                  Delete all versions
                </Button>
              ) : null}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
      {replacementDialog}
    </MessageShell>
  )

  return tree ? (
    article
  ) : (
    <LongBlockFrame
      style={layoutStyle}
      tone={node.role === "user" ? "user" : "assistant"}
    >
      {article}
    </LongBlockFrame>
  )
}, messagePropsAreEqual)
