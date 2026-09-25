"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type Dispatch,
  type SetStateAction,
} from "react"
import { useShallow } from "zustand/react/shallow"
import { AnimatePresence } from "motion/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { HierarchySquare02Icon, ListViewIcon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { cn } from "@/lib/utils"
import { parseJson, resolveActivePath } from "@/lib/domain"
import { displayChatTitle } from "@/lib/chat-title"
import { type PromptVariableValues } from "@/lib/prompt-stack"
import { firstAvailableModel } from "@/lib/provider-models"
import {
  bindVariableLocksToStack,
  generationOverrides,
  modelConfigToSettingValues,
  parseSettingValues,
  replaceGenerationSlice,
  resolveSettings,
  type SettingValues,
} from "@/lib/chat-settings"
import {
  formatSpaceRules,
  spaceChain,
  spaceFromRow,
  spacesById,
} from "@/lib/spaces"
import { SpacePicker } from "./space-picker"
import {
  abortChatStreamReaders,
  chatStreamEntries,
  collectStoppingBuffers,
  hasLiveStreamReader,
  useStreamStore,
} from "@/lib/stream-store"
import { useTRPC } from "@/lib/trpc-react"
import {
  hydrateStreamingNodeParts,
  patchChatTitle,
  patchChatViewState,
  patchNodeFromStreamParts,
  patchSelection,
  patchTerminalGeneration,
  workspaceInput,
  type WorkspaceData,
} from "@/lib/workspace-cache"
import {
  DEFAULT_CHAT_VIEW_STATE,
  chatViewCamerasEqual,
  parseChatViewState,
  type ChatViewCamera,
  type ChatViewState,
} from "@/lib/chat-view-state"
import { motionTransition, shouldAnimate } from "@/lib/appearance"
import type { ModelConfigLocal } from "./types"
import { usePrefersReducedMotion } from "./hooks"
import { ReasoningPicker } from "./reasoning-picker"
import { ModelPicker } from "./model-picker"
import { GenerationParameters } from "./generation-parameters"
import { PromptStackPicker } from "./prompt-stack-picker"
import { ContextBookPicker } from "./context-book-picker"
import { ChatVariablesPicker } from "./chat-variables-picker"
import { ChatHeaderMore } from "./chat-header-more"
import {
  ScheduledGenerationDialog,
  ScheduledGenerationProvider,
  type PendingGeneration,
} from "./scheduled-generation"
import {
  ScheduleClockFields,
  cadenceFromClock,
  defaultScheduleClock,
  scheduleClockError,
  type ScheduleClock,
} from "./schedule-dialog"
import { GenerationCountField } from "./generation-count"
import {
  ChatTemplatePicker,
  chatTemplatePickerLabel,
} from "./chat-template-picker"
import { ChatTranscript } from "./chat-transcript"
import { ChatTree } from "./chat-tree"
import { drainChatViewStateSaves } from "./chat-view-state-persistence"
import { composeLayoutAnchor, composeLayoutId } from "./tree-layout"
import { ConversationFindLayer } from "./conversation-find"
import { ConversationFindBar } from "./conversation-find-bar"
import { useConversationFindSession } from "./conversation-find-session"
import { SessionMessageEditor } from "./message-editor"
import { type MessageEditorBindings } from "./message"
import { ContextPreviewProvider } from "./context-preview"
import {
  MessageMutationProvider,
  type MessageMutationOperation,
} from "./message-mutations"
import {
  composerSlotId,
  clearSubmittedComposerDraft,
  authoredPartsFromSession,
  hasComposerDraft,
  isEditorSending,
  messageEditNodeIdsForChat,
  messageEditSlotId,
  readComposerDraft,
  revokeComposerPreviewUrl,
  shouldDeleteUploadedAttachment,
  treeDraftAnchorsForChat,
  type ComposerAttachment,
  useConversationSessionStore,
  useMessageEditSlotSignature,
  useTreeDraftSlotSignature,
} from "./conversation-session-store"
import { ImageViewer } from "./image-viewer"
import {
  chatReaderDisposalTarget,
  chatRouteIdentity,
} from "./chat-transcript-helpers"
import { useWorkspaceChrome } from "./shell"
import { DocumentTitle } from "@/components/document-title"
import {
  MAX_FILE_ATTACHMENT_BYTES,
  MAX_FILE_ATTACHMENTS,
  type NodeRow,
  type Parts,
} from "@/lib/types"
import { expandPromptMacros, idleSinceFromPath } from "@/lib/prompt-macros"
import { resolveContextEntries } from "@/lib/context-books"
import {
  chatTemplateFromNodes,
  chatTemplateDocumentSchema,
  type ChatTemplateDocument,
} from "@/lib/chat-template"
import {
  assertGenerationCount,
  generationCountInRange,
  MAX_NAME,
} from "@/lib/limits"
import { analyzePdf } from "@/lib/pdf-analysis-client"
import type { PdfAnalysis } from "@/lib/pdf-analysis"
import {
  applyStoppingStreamPatches,
  durablePartsForNode,
  followGenerationStream,
  generationRetryDelay,
  readActionEvents,
  planStreamEnd,
  shouldFollowGeneration,
  shouldSoftFollow,
  streamPlacement,
  viewPathFromCache,
  type StreamEndReason,
} from "./stream-helpers"
import {
  generationBatchResponseSchema,
  type GenerationStartBody,
  type GenerationStartInput,
} from "@/lib/generation-start"
import type { GenerationTerminalPayload } from "@/lib/generation-streams/events"
import { prepareStaticMarkdown } from "@/lib/static-markdown"
import { normalizeLatexDelimiters } from "@/lib/normalize-latex-delimiters"
import {
  coalesceAdjacentTextParts,
  durableAuthoredParts,
  isEmptyParts,
  messagePartsSchema,
  textFromParts,
} from "@/lib/agent/parts"
import { applyContextEntryOverrides } from "@/lib/context-books"

type Props = {
  mode: "draft" | "chat"
  chatId: string | null
  initial: WorkspaceData
  /** When set, select this node into the active path on mount. */
  selectNodeId?: string | null
  draftSpaceId?: string | null
  draftTemplateId?: string | null
  template?: { id: string; name: string }
}

function generationScheduleName(text: string) {
  const trimmed = text.trim().slice(0, MAX_NAME)
  return trimmed || "Generation"
}

function templateSpaceDefaultLabel(names: readonly string[]) {
  if (names.length === 0) return null
  if (names.length === 1) return `Default in ${names[0]}`
  if (names.length === 2) return `Default in ${names[0]} and ${names[1]}`
  const extra = names.length - 1
  return `Default in ${names[0]} and ${extra} other spaces`
}

function generationScheduleNameFromParts(partsJson: string) {
  try {
    const parts = JSON.parse(partsJson) as Parts
    if (!Array.isArray(parts)) return "Generation"
    return generationScheduleName(textFromParts(parts))
  } catch {
    return "Generation"
  }
}

function messagePreviewFromParts(partsJson: string) {
  try {
    const parts = JSON.parse(partsJson) as Parts
    if (!Array.isArray(parts)) return ""
    return textFromParts(parts).trim()
  } catch {
    return ""
  }
}

function attachmentCountLabel(count: number) {
  return `${count} attachment${count === 1 ? "" : "s"}`
}

const EMPTY_DRAFT_TEMPLATE: ChatTemplateDocument = {
  version: 1,
  selectedRootId: null,
  expandMessageMacros: false,
  nodes: [],
}

const SAVE_TEMPLATE_NEW = "__new"

function draftRowsFromTemplate(document: ChatTemplateDocument): NodeRow[] {
  const timestamp = new Date().toISOString()
  return document.nodes.map((node) => ({
    id: node.id,
    chat_id: "draft",
    parent_id: node.parentId,
    selected_child_id: node.selectedChildId,
    sort_key: node.sortKey,
    revision: 0,
    role: node.role,
    parts_json: JSON.stringify(node.parts),
    search_text: "",
    metadata_json: "{}",
    excluded_from_context: node.excludedFromContext,
    status: "complete",
    created_at: timestamp,
    updated_at: timestamp,
  }))
}

function draftTemplateEditSlots() {
  return Object.keys(useConversationSessionStore.getState().sessions).filter(
    (slot) => slot.startsWith("draft:edit:") || slot.startsWith("draft:tree:")
  )
}

function isPdfFile(file: File) {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  )
}

function userSettingsFromWorkspace(data: WorkspaceData): SettingValues {
  const values = modelConfigToSettingValues(data.chatDefaults ?? {})
  if (data.defaultPromptStackId) values.promptStack = data.defaultPromptStackId
  return values
}

function readChatViewState(raw: string | undefined): ChatViewState {
  return raw ? parseChatViewState(raw) : DEFAULT_CHAT_VIEW_STATE
}

function MessageLayer(
  props: ComponentProps<typeof ConversationFindLayer> & {
    resolveOperation?: (
      operation: MessageMutationOperation
    ) => Promise<MessageMutationOperation>
  }
) {
  const { resolveOperation, ...layerProps } = props
  return (
    <MessageMutationProvider resolveOperation={resolveOperation}>
      <ConversationFindLayer {...layerProps} />
    </MessageMutationProvider>
  )
}

export function ChatView({
  mode,
  chatId,
  initial,
  selectNodeId,
  draftSpaceId: initialDraftSpaceId = null,
  draftTemplateId: initialDraftTemplateId = null,
  template,
}: Props) {
  const { appearance, providers: chromeProviders } = useWorkspaceChrome()
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useRouter()
  /** URL-derived selection: null when drafting, string when on /chat/[id] */
  const selectedChatId = mode === "draft" ? null : chatId
  const chatIdentity = chatRouteIdentity(selectedChatId)
  const linearComposerSlot = composerSlotId(selectedChatId, "linear", null)
  const updateSessionDraft = useConversationSessionStore(
    (state) => state.update
  )
  const setSessionSending = useConversationSessionStore(
    (state) => state.setSending
  )
  const clearSessionDraft = useConversationSessionStore((state) => state.clear)
  const clearSessionChat = useConversationSessionStore(
    (state) => state.clearChat
  )
  const [viewer, setViewer] = useState<{ src: string; name: string } | null>(
    null
  )
  const [resourcePickerOpen, setResourcePickerOpen] = useState(false)
  const [promptPickerOpen, setPromptPickerOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameTitle, setRenameTitle] = useState("")
  const [templateName, setTemplateName] = useState(template?.name ?? "")
  const templateId = template?.id
  const seededTemplateName = template?.name
  useEffect(() => {
    if (seededTemplateName !== undefined) setTemplateName(seededTemplateName)
  }, [templateId, seededTemplateName])
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState("")
  const [replaceTemplateId, setReplaceTemplateId] = useState(SAVE_TEMPLATE_NEW)
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleClock, setScheduleClock] = useState<ScheduleClock>(() =>
    defaultScheduleClock()
  )
  const [scheduleReplyCount, setScheduleReplyCount] = useState(1)
  const [scheduleSendOpen, setScheduleSendOpen] = useState(false)
  const [templateScheduleOpen, setTemplateScheduleOpen] = useState(false)
  const [templateScheduleName, setTemplateScheduleName] = useState("")
  const [templateScheduleClock, setTemplateScheduleClock] =
    useState<ScheduleClock>(() => defaultScheduleClock())
  const [templateScheduleReplyCount, setTemplateScheduleReplyCount] =
    useState(1)
  const [templateScheduleSource, setTemplateScheduleSource] = useState<{
    slot: string
    parentId: string | null
    chatId: string | null
    document: ChatTemplateDocument | null
    draft: ReturnType<typeof readComposerDraft>
  } | null>(null)
  const [scheduleToCancel, setScheduleToCancel] = useState<string | null>(null)
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(
    null
  )
  const [scheduleSource, setScheduleSource] = useState<{
    slot: string | null
    parentId: string | null
    draft: ReturnType<typeof readComposerDraft>
  } | null>(null)
  const [scheduleSendClock, setScheduleSendClock] = useState<ScheduleClock>(
    () => ({
      ...defaultScheduleClock(),
      kind: "once",
    })
  )
  const [scheduleSendReplyCount, setScheduleSendReplyCount] = useState(1)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [pendingTemplateId, setPendingTemplateId] = useState<
    string | null | undefined
  >(undefined)
  const [parametersOpen, setParametersOpen] = useState(false)
  const [stackOpen, setStackOpen] = useState(false)
  const [booksOpen, setBooksOpen] = useState(false)
  const [variablesOpen, setVariablesOpen] = useState(false)
  const [spaceOpen, setSpaceOpen] = useState(false)
  const [draftSettings, setDraftSettings] = useState<SettingValues>({})
  const [draftContextBookIds, setDraftContextBookIds] = useState<string[]>([])
  const [draftSpaceId, setDraftSpaceId] = useState<string | null>(
    initialDraftSpaceId
  )
  const [draftTemplateId, setDraftTemplateId] = useState<string | null>(
    initialDraftTemplateId
  )
  const [draftTemplateDocument, setDraftTemplateDocument] =
    useState<ChatTemplateDocument>(EMPTY_DRAFT_TEMPLATE)
  const [draftTemplateRootId, setDraftTemplateRootId] = useState<string | null>(
    null
  )
  const [draftTemplateNodes, setDraftTemplateNodes] = useState<NodeRow[]>([])
  const [treeComposerRoles, setTreeComposerRoles] = useState<
    Record<string, "user" | "assistant">
  >({})
  const [inFlightCount, setInFlightCount] = useState(0)
  const [viewState, setViewState] = useState<ChatViewState>(() =>
    readChatViewState(initial.chat?.view_state_json)
  )
  const [viewStateIdentity, setViewStateIdentity] = useState(chatIdentity)
  const viewStatesRef = useRef(new Map([[chatIdentity, viewState]]))
  const pendingViewStatesRef = useRef(new Map<string, ChatViewState>())
  const viewPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewPersistingRef = useRef(false)
  const viewSaveErrorShownRef = useRef(false)
  // React can preserve this client component across soft navigation. Resetting
  // during render prevents the prior chat's tree from committing for one frame.
  let renderedViewState = viewState
  if (viewStateIdentity !== chatIdentity) {
    renderedViewState =
      viewStatesRef.current.get(chatIdentity) ??
      readChatViewState(initial.chat?.view_state_json)
    viewStatesRef.current.set(chatIdentity, renderedViewState)
    setViewState(renderedViewState)
    setViewStateIdentity(chatIdentity)
  }
  const view = renderedViewState.mode
  /** User node id → compose-slot id. Tree owns the overlay; this only names the pair. */
  const [composeMorphs, setComposeMorphs] = useState<Record<string, string>>({})
  /** Which composer slot MCP pickers write into. */
  const [pickerSlot, setPickerSlot] = useState(linearComposerSlot)
  /** Set when a draft creates a chat before `router.replace` remounts ChatView. */
  const [pendingChatId, setPendingChatId] = useState<string | null>(null)
  /**
   * Explicit transcript jump (deep link / branch pick). Never set from stream
   * soft-follow — that only changes selection; viewport follow is autoScroll.
   */
  const [scrollTargetId, setScrollTargetId] = useState<string | null>(null)
  const paneRef = useRef<HTMLElement>(null)
  const createChatLock = useRef<Promise<string> | null>(null)
  const draftMaterializationId = useRef(crypto.randomUUID())
  const draftNodeIdMap = useRef<Record<string, string>>({})
  const selectedChatIdRef = useRef(selectedChatId)
  const nodeDeepLinkDone = useRef(false)
  /** Last route identity we bound deep-link / scroll lifecycle to. */
  const boundChatIdentityRef = useRef<string | null>(null)
  const aliveRef = useRef(true)
  const disposalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Removed uploads can finish after their chip is gone; delete their server row. */
  const cancelledUploadIds = useRef(new Set<string>())
  const consumeScrollTarget = useCallback(() => setScrollTargetId(null), [])
  const disposeSessionChat = useCallback(
    (chatId: string | null) => {
      const prefix = `${chatId ?? "draft"}:`
      const sessions = useConversationSessionStore.getState().sessions
      for (const [slot, session] of Object.entries(sessions)) {
        if (!slot.startsWith(prefix)) continue
        for (const attachment of session.attachments) {
          if (attachment.previewUrl)
            revokeComposerPreviewUrl(attachment.previewUrl)
          if (attachment.reference.kind !== "uploaded-file") continue
          if (attachment.uploading) {
            cancelledUploadIds.current.add(attachment.reference.id)
          } else if (shouldDeleteUploadedAttachment(attachment)) {
            void fetch(`/api/attachments/${attachment.reference.id}`, {
              method: "DELETE",
            })
          }
        }
      }
      clearSessionChat(chatId)
    },
    [clearSessionChat]
  )
  // Sync route selection only when URL has a real chat id. On draft (null) we
  // intentionally keep ensureChatId's assigned id until navigation remounts.
  useEffect(() => {
    if (selectedChatId !== null) selectedChatIdRef.current = selectedChatId
  }, [selectedChatId])
  useEffect(() => {
    if (disposalTimerRef.current) clearTimeout(disposalTimerRef.current)
    disposalTimerRef.current = null
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      const bound = boundChatIdentityRef.current
      // Delay destructive disposal by one task so React development strict
      // effects can remount without deleting a live draft.
      disposalTimerRef.current = setTimeout(() => {
        if (aliveRef.current) return
        // Drop local readers only. The producer keeps running; the next visit
        // sees activeGenerations and follows from the stored cursor. A draft's
        // pending chat is the destination of router.replace, not a chat being
        // left; its existing reader must survive the page handoff.
        abortChatStreamReaders([chatReaderDisposalTarget(bound)])
        if (bound) disposeSessionChat(bound === "draft" ? null : bound)
      }, 0)
    }
  }, [disposeSessionChat])

  // Soft-nav between /chat/[id] reuses this component instance. Drop scroll
  // targets and re-enable deep links for the chat now on screen.
  useEffect(() => {
    if (boundChatIdentityRef.current === chatIdentity) return
    const previous = boundChatIdentityRef.current
    boundChatIdentityRef.current = chatIdentity
    // A soft navigation to /chat/new starts a genuinely new draft. Do not
    // let the previous chat id make ensureChatId reuse that conversation;
    // ensureChatId writes a newly-created id back here for the duration of the
    // draft handoff.
    if (chatIdentity === "draft" && previous !== "draft") {
      selectedChatIdRef.current = null
      setPendingChatId(null)
    }
    setScrollTargetId(null)
    if (previous) {
      const previousChatId = previous === "draft" ? null : previous
      if (previousChatId) abortChatStreamReaders([previousChatId])
      disposeSessionChat(previousChatId)
    }
    setPickerSlot(composerSlotId(selectedChatId, "linear", null))
    setComposeMorphs({})
    nodeDeepLinkDone.current = false
  }, [chatIdentity, disposeSessionChat, selectedChatId])

  const prefersReduced = usePrefersReducedMotion()
  const animate = shouldAnimate(appearance.motion, prefersReduced)
  const transition = motionTransition(appearance.motion)

  const startStream = useStreamStore((state) => state.start)
  const applyStreamEvent = useStreamStore((state) => state.applyEvent)
  const setStreamCursor = useStreamStore((state) => state.setCursor)
  const attachController = useStreamStore((state) => state.attachController)
  const detachController = useStreamStore((state) => state.detachController)
  const stopStream = useStreamStore((state) => state.stop)
  const settleStream = useStreamStore((state) => state.settle)
  const finishStream = useStreamStore((state) => state.finish)
  /** Placement only. Token text lives in buffers; Message reads those. */
  const streamMetas = useStreamStore((state) => state.streams)
  const stoppingBuffers = useStreamStore(
    useShallow((state) => collectStoppingBuffers(state.streams, state.buffers))
  )

  const applyStreamEnd = useCallback(
    (
      streamId: string,
      reason: StreamEndReason,
      controller?: AbortController
    ) => {
      const store = useStreamStore.getState()
      const meta = store.streams[streamId]
      if (!meta) {
        if (controller) detachController(streamId, controller)
        finishStream(streamId)
        return
      }
      const cached = queryClient.getQueryData<WorkspaceData>(
        trpc.workspace.get.queryKey({ chatId: meta.chatId })
      )
      const parts = store.buffers[streamId]?.parts ?? []
      const plan = planStreamEnd({
        reason,
        stopping: Boolean(meta.stopping),
        nodeStatus: cached?.nodes.find((row) => row.id === meta.nodeId)?.status,
        hasParts: parts.length > 0,
      })
      if (plan.keepStore) {
        detachController(streamId, controller)
        return
      }
      if (plan.write === "aborted") {
        queryClient.setQueriesData<WorkspaceData>(
          trpc.workspace.get.queryFilter(),
          (old) => patchNodeFromStreamParts(old, meta.nodeId, parts, "aborted")
        )
      } else if (plan.write === "hydrate") {
        queryClient.setQueriesData<WorkspaceData>(
          trpc.workspace.get.queryFilter(),
          (old) => hydrateStreamingNodeParts(old, meta.nodeId, parts)
        )
      }
      if (plan.dropOverlay) settleStream(streamId)
      if (plan.invalidate) {
        void queryClient.invalidateQueries({
          queryKey: trpc.workspace.get.queryKey({ chatId: meta.chatId }),
        })
      }
    },
    [
      detachController,
      finishStream,
      queryClient,
      settleStream,
      trpc.workspace.get,
    ]
  )

  const applyTerminalHandoff = useCallback(
    async (
      streamId: string,
      terminal: GenerationTerminalPayload,
      controller?: AbortController
    ) => {
      const store = useStreamStore.getState()
      const meta = store.streams[streamId]
      if (!meta) return
      const node = terminal.node
      if (node && (node.id !== meta.nodeId || node.chat_id !== meta.chatId)) {
        // Never let a stale/replayed terminal overwrite another generation.
        applyStreamEnd(streamId, "gone", controller)
        return
      }
      if (node) {
        const parts = coalesceAdjacentTextParts(parseJson(node.parts_json, []))
        for (const part of parts) {
          if (part.type !== "text" && part.type !== "reasoning") continue
          prepareStaticMarkdown(normalizeLatexDelimiters(part.text, false))
        }
      }
      // A reconciliation started while this generation was still streaming can
      // resolve after the terminal event. Cancel its exact query before this
      // authoritative snapshot reaches the cache so the stale result is ignored.
      await queryClient.cancelQueries({
        queryKey: trpc.workspace.get.queryKey({ chatId: meta.chatId }),
        exact: true,
      })
      queryClient.setQueriesData<WorkspaceData>(
        trpc.workspace.get.queryFilter(),
        (old) =>
          patchTerminalGeneration(old, {
            generationId: streamId,
            node,
            chatId: meta.chatId,
            nodeId: meta.nodeId,
          })
      )
      finishStream(streamId)
      if (
        !node ||
        terminal.result === "superseded" ||
        terminal.result === "missing"
      ) {
        void queryClient.invalidateQueries({
          queryKey: trpc.workspace.get.queryKey({ chatId: meta.chatId }),
        })
      }
    },
    [applyStreamEnd, finishStream, queryClient, trpc.workspace.get]
  )

  // A first submission creates its chat before the route transition commits.
  // Query that durable chat during the handoff; never seed its key with the
  // draft route's intentionally empty initial workspace.
  const workspaceChatId = selectedChatId ?? pendingChatId
  const workspaceKeyInput = workspaceInput(workspaceChatId)
  const workspaceQuery = useQuery({
    ...trpc.workspace.get.queryOptions(workspaceKeyInput),
    ...(workspaceChatId === selectedChatId ? { initialData: initial } : {}),
  })

  // Shell already loaded providers; re-query stays warm without a page parallel fetch.
  const providersQuery = useQuery({
    ...trpc.workspace.listProviders.queryOptions(),
    initialData: chromeProviders,
  })
  const templatesQuery = useQuery(
    trpc.workspace.listChatTemplates.queryOptions()
  )
  const schedulesQuery = useQuery(trpc.workspace.listSchedules.queryOptions())
  const templateOptions = (templatesQuery.data ?? []).map((template) => ({
    id: template.id,
    name: template.name,
    nodeCount: template.document.nodes.length,
  }))
  const appliedSpaceTemplate = useRef<string | null>(null)
  const selectDraftTemplate = useCallback(
    (templateId: string | null) => {
      for (const slot of draftTemplateEditSlots()) clearSessionDraft(slot)
      setDraftTemplateId(templateId)
      const applyMessageMacros = (expand: boolean) => {
        setDraftSettings((current) => {
          const next = { ...current }
          if (expand) next.expandMessageMacros = true
          else delete next.expandMessageMacros
          return next
        })
      }
      if (!templateId) {
        setDraftTemplateDocument(EMPTY_DRAFT_TEMPLATE)
        setDraftTemplateRootId(null)
        setDraftTemplateNodes([])
        applyMessageMacros(false)
        return
      }
      const template = templatesQuery.data?.find(
        (item) => item.id === templateId
      )
      if (!template) {
        setDraftTemplateDocument(EMPTY_DRAFT_TEMPLATE)
        setDraftTemplateRootId(null)
        setDraftTemplateNodes([])
        applyMessageMacros(false)
        return
      }
      const document = chatTemplateDocumentSchema.parse(
        structuredClone(template.document)
      )
      setDraftTemplateDocument(document)
      setDraftTemplateRootId(document.selectedRootId)
      applyMessageMacros(document.expandMessageMacros)
      setDraftTemplateNodes(draftRowsFromTemplate(document))
    },
    [clearSessionDraft, templatesQuery.data]
  )
  const requestDraftTemplate = useCallback(
    (templateId: string | null) => {
      if (templateId === draftTemplateId) return
      if (draftTemplateEditSlots().length > 0) {
        setPendingTemplateId(templateId)
        return
      }
      selectDraftTemplate(templateId)
    },
    [draftTemplateId, selectDraftTemplate]
  )
  const workspace = workspaceQuery.data ?? initial
  const data: WorkspaceData = useMemo(
    () =>
      applyStoppingStreamPatches(workspace, streamMetas, stoppingBuffers) ??
      workspace,
    [stoppingBuffers, streamMetas, workspace]
  )
  const nodes = data.chat ? data.nodes : draftTemplateNodes
  useEffect(() => {
    // Draft routes can be reused by the App Router without changing the
    // component identity. Once the pending create has been handed off, an
    // empty draft must never inherit the last visited chat id.
    if (mode === "draft" && pendingChatId === null && !data.chat) {
      selectedChatIdRef.current = null
    }
  }, [data.chat, mode, pendingChatId])
  const providers = providersQuery.data ?? chromeProviders
  const knownChats = data.chats
  const templateUsageLabel = useMemo(() => {
    if (!template) return null
    const schedules = (schedulesQuery.data?.schedules ?? []).filter(
      (schedule) => schedule.templateId === template.id
    )
    const scheduleLabel =
      schedules.length === 0
        ? null
        : schedules.some((schedule) => schedule.enabled)
          ? "Scheduled"
          : "Schedule paused"
    const spaceNames = (data.spaces ?? [])
      .map(spaceFromRow)
      .filter((space) => {
        const policy = space.settings.chatTemplate
        return policy?.value === template.id && policy.mode !== "release"
      })
      .map((space) => space.name)
    const parts = [scheduleLabel, templateSpaceDefaultLabel(spaceNames)].filter(
      (part): part is string => Boolean(part)
    )
    return parts.length ? `${parts.join(". ")}.` : null
  }, [data.spaces, schedulesQuery.data?.schedules, template])

  // Reload/navigation discovery only: a currently-open peer is intentionally
  // not notified until its normal workspace query is refreshed.
  useEffect(() => {
    const store = useStreamStore.getState()
    const nodesById = new Map(workspace.nodes.map((row) => [row.id, row]))
    const activeIds = new Set(
      workspace.activeGenerations.map((generation) => generation.generationId)
    )

    for (const generation of workspace.activeGenerations) {
      const streamId = generation.generationId
      if (
        !shouldFollowGeneration({
          streamId,
          node: nodesById.get(generation.nodeId),
          controllers: store.controllers,
          stream: store.streams[streamId],
        })
      )
        continue
      const controller = new AbortController()
      startStream(streamId, {
        nodeId: generation.nodeId,
        chatId: generation.chatId,
        parentNodeId: generation.parentNodeId,
        parts: durablePartsForNode(workspace.nodes, generation.nodeId),
      })
      attachController(streamId, controller)
      void followGenerationStream({
        streamId,
        signal: controller.signal,
        cursor: useStreamStore.getState().cursors[streamId] ?? null,
        onEvent: (event) => applyStreamEvent(streamId, event),
        onCursor: (cursor) => setStreamCursor(streamId, cursor),
      }).then(async (result) => {
        if (typeof result === "object")
          await applyTerminalHandoff(streamId, result.terminal, controller)
        else applyStreamEnd(streamId, result, controller)
      })
    }

    const wanted = new Set<string>()
    for (const id of [selectedChatId, pendingChatId, workspace.chat?.id]) {
      if (id) wanted.add(id)
    }
    for (const [streamId, meta] of Object.entries(store.streams)) {
      if (!wanted.has(meta.chatId)) continue
      if (activeIds.has(streamId)) continue
      if (meta.settled) {
        finishStream(streamId)
        continue
      }
      if (hasLiveStreamReader(store.controllers, streamId)) continue
      applyStreamEnd(streamId, "gone")
    }
  }, [
    applyStreamEnd,
    applyTerminalHandoff,
    applyStreamEvent,
    attachController,
    finishStream,
    pendingChatId,
    selectedChatId,
    setStreamCursor,
    startStream,
    workspace.activeGenerations,
    workspace.chat?.id,
    workspace.nodes,
  ])

  const spaceId = data.chat?.space_id ?? draftSpaceId
  const settingsQuery = useQuery(trpc.workspace.getSettings.queryOptions())
  const userLayer = useMemo(
    () => ({
      ...userSettingsFromWorkspace(data),
      ...settingsQuery.data?.userTitleSettings,
    }),
    [data, settingsQuery.data?.userTitleSettings]
  )
  const chatOverrides = data.chat
    ? parseSettingValues(data.chat.settings_json)
    : draftSettings
  const storedPromptStackId =
    typeof chatOverrides.promptStack === "string"
      ? chatOverrides.promptStack
      : null
  const chatContextBooksQuery = useQuery({
    ...trpc.workspace.listChatContextBooks.queryOptions({
      chatId: data.chat?.id ?? "",
    }),
    enabled: Boolean(data.chat),
  })
  const chatContextBookIds = data.chat
    ? (chatContextBooksQuery.data ?? [])
    : draftContextBookIds
  const resolvedSettings = useMemo(
    () =>
      resolveSettings({
        admin: settingsQuery.data?.adminTitleSettings,
        user: userLayer,
        chat: chatOverrides,
        spaceId,
        spaces: (data.spaces ?? []).map(spaceFromRow),
        contextBookIds: chatContextBookIds,
      }),
    [
      userLayer,
      chatOverrides,
      spaceId,
      chatContextBookIds,
      data.spaces,
      settingsQuery.data?.adminTitleSettings,
    ]
  )
  const inheritedSettings = useMemo(
    () =>
      resolveSettings({
        admin: settingsQuery.data?.adminTitleSettings,
        user: userLayer,
        chat: {},
        spaceId,
        spaces: (data.spaces ?? []).map(spaceFromRow),
        contextBookIds: chatContextBookIds,
      }),
    [
      userLayer,
      spaceId,
      chatContextBookIds,
      data.spaces,
      settingsQuery.data?.adminTitleSettings,
    ]
  )
  const activeModelConfig = resolvedSettings.effective.model
  const effectivePromptStackId = resolvedSettings.effective.promptStackId
  useEffect(() => {
    if (mode !== "draft") return
    const spaceTemplateId = resolvedSettings.effective.chatTemplateId
    const urlTemplateId = initialDraftTemplateId
    if ((spaceTemplateId || urlTemplateId) && !templatesQuery.data) return
    const signature = JSON.stringify([spaceId, spaceTemplateId])
    if (appliedSpaceTemplate.current === signature) return
    const locked = Boolean(resolvedSettings.locks.chatTemplate)
    const honorUrl =
      Boolean(urlTemplateId) && !locked && appliedSpaceTemplate.current === null
    appliedSpaceTemplate.current = signature
    selectDraftTemplate(honorUrl ? urlTemplateId : spaceTemplateId)
  }, [
    initialDraftTemplateId,
    mode,
    resolvedSettings.effective.chatTemplateId,
    resolvedSettings.locks.chatTemplate,
    selectDraftTemplate,
    spaceId,
    templatesQuery.data,
  ])
  const declaredVariableNames = useMemo(() => {
    const stacks = settingsQuery.data?.promptStacks ?? []
    const defaultId = settingsQuery.data?.defaultPromptStackId
    const stackId = effectivePromptStackId ?? defaultId
    const stack = stacks.find((row) => row.id === stackId)
    return (stack?.stack.variables ?? []).map((variable) => variable.name)
  }, [
    settingsQuery.data?.promptStacks,
    settingsQuery.data?.defaultPromptStackId,
    effectivePromptStackId,
  ])
  const settingLocks = bindVariableLocksToStack(
    resolvedSettings.locks,
    declaredVariableNames
  )
  const previewContextBooks = useMemo(() => {
    const books = settingsQuery.data?.contextBooks ?? []
    const spaceBookIds = new Set(
      spaceChain(
        spaceId,
        spacesById((data.spaces ?? []).map(spaceFromRow))
      ).flatMap((space) =>
        Object.entries(space.settings.books?.decisions ?? {}).flatMap(
          ([id, decision]) => (decision === "include" ? [id] : [])
        )
      )
    )
    return resolvedSettings.effective.contextBookIds.flatMap((id) => {
      const book = books.find((item) => item.id === id)
      return book
        ? [
            applyContextEntryOverrides(
              {
                ...book,
                source: spaceBookIds.has(id)
                  ? ("space" as const)
                  : ("chat" as const),
              },
              resolvedSettings.effective.contextEntryDecisions[id]
            ),
          ]
        : []
    })
  }, [
    data.spaces,
    resolvedSettings.effective.contextEntryDecisions,
    resolvedSettings.effective.contextBookIds,
    settingsQuery.data?.contextBooks,
    spaceId,
  ])

  const invalidateWorkspace = async () => {
    await Promise.all([
      queryClient.invalidateQueries(trpc.workspace.get.queryFilter()),
      queryClient.invalidateQueries(trpc.workspace.listSchedules.queryFilter()),
      ...(template
        ? [
            queryClient.invalidateQueries(
              trpc.workspace.listChatTemplates.queryFilter()
            ),
          ]
        : []),
    ])
  }

  const materializeTemplateMutation = useMutation(
    trpc.workspace.materializeChatTemplate.mutationOptions()
  )
  const saveTemplateMutation = useMutation(
    trpc.workspace.saveChatTemplateFromChat.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(
          trpc.workspace.listChatTemplates.queryFilter()
        )
        toast.success("Chat template saved")
        setSaveTemplateOpen(false)
      },
      onError: (error) => toast.error(error.message),
    })
  )
  const scheduleFromChatMutation = useMutation(
    trpc.workspace.scheduleFromChat.mutationOptions({
      onSuccess: async (_result, input) => {
        await Promise.all([
          queryClient.invalidateQueries(
            trpc.workspace.listChatTemplates.queryFilter()
          ),
          queryClient.invalidateQueries(
            trpc.workspace.listSchedules.queryFilter()
          ),
        ])
        toast.success(
          input.templateId ? "Template and schedule updated" : "Schedule saved"
        )
        setSaveTemplateOpen(false)
      },
      onError: (error) => toast.error(error.message),
    })
  )
  const sendAndScheduleTemplateMutation = useMutation(
    trpc.workspace.sendAndScheduleTemplate.mutationOptions()
  )
  const createChatScheduleMutation = useMutation(
    trpc.workspace.createChatSchedule.mutationOptions()
  )
  const cancelScheduleMutation = useMutation(
    trpc.workspace.deleteSchedule.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries(
            trpc.workspace.listSchedules.queryFilter()
          ),
          queryClient.invalidateQueries(trpc.workspace.get.queryFilter()),
        ])
      },
      onError: (error) => toast.error(error.message),
    })
  )
  const createMessageMutation = useMutation(
    trpc.workspace.createMessage.mutationOptions()
  )
  const forkMessagePartsMutation = useMutation(
    trpc.workspace.forkMessageParts.mutationOptions()
  )

  const surfacesQuery = useQuery(
    trpc.workspace.listApprovedMcpSurfaces.queryOptions()
  )
  /** Enabled, runtime-supported profiles that generation would load. */
  const mcpAvailableForGeneration = (surfacesQuery.data?.length ?? 0) > 0
  const getPromptMut = useMutation(
    trpc.workspace.getMcpPrompt.mutationOptions({
      onError: (error) =>
        toast.error(error.message || "Could not load MCP prompt"),
    })
  )

  const updateChatMutation = useMutation(
    trpc.workspace.updateChat.mutationOptions({
      onMutate: async (input) => {
        await queryClient.cancelQueries(trpc.workspace.get.queryFilter())
        const previous = queryClient.getQueriesData<WorkspaceData>(
          trpc.workspace.get.queryFilter()
        )
        if (input.title) {
          queryClient.setQueriesData<WorkspaceData>(
            trpc.workspace.get.queryFilter(),
            (old) => patchChatTitle(old, input.chatId, input.title!)
          )
        }
        return { previous }
      },
      onError: (_error, _input, context) => {
        for (const [key, data] of context?.previous ?? []) {
          queryClient.setQueryData(key, data)
        }
        toast.error("Could not update conversation")
      },
      onSettled: async () => {
        await invalidateWorkspace()
      },
    })
  )
  const renameTemplateMutation = useMutation(
    trpc.workspace.renameChatTemplate.mutationOptions({
      onError: (error) =>
        toast.error(error.message || "Could not rename template"),
      onSettled: async () => {
        await invalidateWorkspace()
      },
    })
  )

  const setChatViewStateMutation = useMutation({
    ...trpc.workspace.setChatViewState.mutationOptions(),
    retry: 2,
  })
  const persistViewStateRef = useRef(setChatViewStateMutation.mutateAsync)
  persistViewStateRef.current = setChatViewStateMutation.mutateAsync
  const flushChatViewStateRef = useRef<() => void>(() => {})

  const flushChatViewState = useCallback(() => {
    if (viewPersistTimerRef.current) {
      clearTimeout(viewPersistTimerRef.current)
      viewPersistTimerRef.current = null
    }
    if (viewPersistingRef.current) return
    viewPersistingRef.current = true
    void (async () => {
      let failed = false
      try {
        const result = await drainChatViewStateSaves(
          pendingViewStatesRef.current,
          persistViewStateRef.current,
          {
            onSaved: () => {
              viewSaveErrorShownRef.current = false
            },
            onFailed: () => {
              if (viewSaveErrorShownRef.current) return
              viewSaveErrorShownRef.current = true
              toast.error("Could not save conversation view")
            },
          }
        )
        failed = result.failed
      } finally {
        viewPersistingRef.current = false
        if (!failed && pendingViewStatesRef.current.size > 0)
          flushChatViewStateRef.current()
      }
    })()
  }, [])
  flushChatViewStateRef.current = flushChatViewState

  const queueChatViewState = useCallback(
    (chatId: string, state: ChatViewState, immediate = false) => {
      pendingViewStatesRef.current.set(chatId, state)
      queryClient.setQueriesData<WorkspaceData>(
        trpc.workspace.get.queryFilter(),
        (old) => patchChatViewState(old, chatId, state)
      )
      if (immediate) {
        flushChatViewState()
        return
      }
      if (viewPersistTimerRef.current) clearTimeout(viewPersistTimerRef.current)
      viewPersistTimerRef.current = setTimeout(flushChatViewState, 300)
    },
    [flushChatViewState, queryClient, trpc.workspace.get]
  )

  const setPersistedView = useCallback<
    Dispatch<SetStateAction<"linear" | "tree">>
  >(
    (next) => {
      const current =
        viewStatesRef.current.get(chatIdentity) ?? DEFAULT_CHAT_VIEW_STATE
      const mode = typeof next === "function" ? next(current.mode) : next
      if (mode === current.mode) return
      const updated = { ...current, mode }
      viewStatesRef.current.set(chatIdentity, updated)
      setViewState(updated)
      if (selectedChatId) queueChatViewState(selectedChatId, updated, true)
    },
    [chatIdentity, queueChatViewState, selectedChatId]
  )

  const persistTreeCamera = useCallback(
    (chatId: string, camera: ChatViewCamera | null) => {
      const current = viewStatesRef.current.get(chatId)
      if (!current) return
      if (chatViewCamerasEqual(current.camera, camera)) return
      const updated = { ...current, camera }
      viewStatesRef.current.set(chatId, updated)
      // ChatTree owns the live camera. Updating React state here would rebuild
      // the pane on every pan; setPersistedView reads the ref on mode changes.
      queueChatViewState(chatId, updated, true)
    },
    [queueChatViewState]
  )

  useEffect(() => {
    const flushOnHidden = () => {
      if (document.visibilityState === "hidden") flushChatViewState()
    }
    const flushOnOnline = () => flushChatViewState()
    document.addEventListener("visibilitychange", flushOnHidden)
    window.addEventListener("online", flushOnOnline)
    return () => {
      document.removeEventListener("visibilitychange", flushOnHidden)
      window.removeEventListener("online", flushOnOnline)
      flushChatViewState()
    }
  }, [flushChatViewState])

  const selectChildMutation = useMutation(
    trpc.workspace.selectChild.mutationOptions({
      onMutate: async (input) => {
        await queryClient.cancelQueries(trpc.workspace.get.queryFilter())
        const key = trpc.workspace.get.queryKey(workspaceKeyInput)
        const previous = queryClient.getQueryData(key)
        queryClient.setQueryData(
          key,
          patchSelection(previous, {
            kind: "child",
            nodeId: input.nodeId,
            childId: input.childId,
          })
        )
        return { previous, key }
      },
      onError: (_error, _input, context) => {
        if (context?.previous)
          queryClient.setQueryData(context.key, context.previous)
      },
      onSettled: async () => {
        await invalidateWorkspace()
      },
    })
  )

  const selectRootMutation = useMutation(
    trpc.workspace.selectRoot.mutationOptions({
      onMutate: async (input) => {
        await queryClient.cancelQueries(trpc.workspace.get.queryFilter())
        const key = trpc.workspace.get.queryKey(workspaceKeyInput)
        const previous = queryClient.getQueryData(key)
        queryClient.setQueryData(
          key,
          patchSelection(previous, { kind: "root", nodeId: input.nodeId })
        )
        return { previous, key }
      },
      onError: (_error, _input, context) => {
        if (context?.previous)
          queryClient.setQueryData(context.key, context.previous)
      },
      onSettled: async () => {
        await invalidateWorkspace()
      },
    })
  )

  const selectPathMutation = useMutation(
    trpc.workspace.selectPath.mutationOptions({
      onSuccess: async () => {
        await invalidateWorkspace()
      },
      onError: (error) => {
        toast.error(error.message || "Could not switch path")
      },
    })
  )

  useEffect(() => {
    if (!selectNodeId || !chatId) return
    // One deep-link apply per chat route; chat identity reset allows a later chat.
    if (nodeDeepLinkDone.current) return
    nodeDeepLinkDone.current = true
    selectPathMutation.mutate({ chatId, nodeId: selectNodeId })
    setScrollTargetId(selectNodeId)
    // Replace URL to drop the query after applying (clean shareable chat URL)
    router.replace(`/chat/${chatId}`, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deep link once per chat identity
  }, [selectNodeId, chatId])

  const density = appearance.density

  const renderNodes = useMemo(() => {
    if (!activeModelConfig.expandMessageMacros) return nodes
    const now = new Date()
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const literalPath = resolveActivePath(
      nodes,
      data.chat?.selected_root_node_id ?? draftTemplateRootId
    )
    const baseMacroContext = {
      now,
      timeZone,
      idleSince: idleSinceFromPath(literalPath),
      ...(data.chat
        ? {
            chat: {
              id: data.chat.id,
              createdAt: new Date(data.chat.created_at),
            },
          }
        : {}),
      variables: resolvedSettings.effective.variables as Record<
        string,
        string | boolean
      >,
    }
    const contextEntries = resolveContextEntries({
      books: previewContextBooks,
      messages: literalPath.flatMap((node) => {
        if (
          node.excluded_from_context ||
          (node.role !== "user" && node.role !== "assistant")
        )
          return []
        return [
          {
            role: node.role,
            text: parseJson<Parts>(node.parts_json, [])
              .flatMap((part) => (part.type === "text" ? [part.text] : []))
              .join("\n"),
          },
        ]
      }),
      scanDepth: activeModelConfig.contextScanDepth,
      macroContext: baseMacroContext,
    })
    const macroContext = {
      ...baseMacroContext,
      contextEntries: contextEntries.namespaces,
    }
    return nodes.map((node) => {
      const literalParts = parseJson<Parts>(node.parts_json, [])
      const parts = literalParts.map((part) =>
        part.type === "text"
          ? { ...part, text: expandPromptMacros(part.text, macroContext) }
          : part
      )
      return {
        ...node,
        parts_json: JSON.stringify(parts),
        metadata_json: JSON.stringify({
          ...parseJson<Record<string, unknown>>(node.metadata_json, {}),
          literalParts,
          liveMacroContext: {
            ...macroContext,
            now: now.toISOString(),
            ...(macroContext.chat
              ? {
                  chat: {
                    ...macroContext.chat,
                    createdAt: macroContext.chat.createdAt.toISOString(),
                  },
                }
              : {}),
          },
        }),
      }
    })
  }, [
    data.chat,
    nodes,
    draftTemplateRootId,
    previewContextBooks,
    activeModelConfig.contextScanDepth,
    activeModelConfig.expandMessageMacros,
    resolvedSettings.effective.variables,
  ])

  const activePath = useMemo(
    () =>
      resolveActivePath(
        renderNodes,
        data.chat?.selected_root_node_id ?? draftTemplateRootId
      ),
    [data.chat?.selected_root_node_id, draftTemplateRootId, renderNodes]
  )
  const pathIds = useMemo(() => activePath.map((node) => node.id), [activePath])
  const find = useConversationFindSession({
    chatIdentity,
    view,
    setView: setPersistedView,
    nodes,
    pathIds,
    pathChatId: data.chat?.id ?? chatId,
    renameOpen,
    paneRef,
    selectPath: (input, options) => selectPathMutation.mutate(input, options),
    selectPathPending: selectPathMutation.isPending,
    setScrollTargetId,
  })

  function ensureModelReady(config: ModelConfigLocal) {
    if (config.providerId && config.model) return true
    if (firstAvailableModel(providers)) return true
    toast.error("Choose a provider and model before sending a message.")
    return false
  }

  async function runGenerationAction(
    body: GenerationStartInput,
    options?: {
      modelConfig?: ModelConfigLocal
      onStreamStarted?: (info: {
        userNodeId: string | null
        assistantNodeId: string
      }) => void
      onWorkspaceReady?: (info: {
        userNodeId: string | null
        assistantNodeId: string
      }) => void | Promise<void>
      suppressSelectionFollow?: boolean
    }
  ) {
    const modelConfig = options?.modelConfig ?? activeModelConfig
    if (!ensureModelReady(modelConfig)) return false
    const expectedCount = body.intent === "resume" ? 1 : (body.replyCount ?? 1)
    if (aliveRef.current) setInFlightCount((n) => n + expectedCount)
    let failed = false
    const started = new Map<string, AbortController>()
    const actionId = crypto.randomUUID()
    const controller = new AbortController()
    let actionCursor: string | null = null
    let manifestSeen = false
    let reconcile: Promise<void> | null = null
    const terminalTasks: Promise<void>[] = []
    try {
      const requestBody: GenerationStartBody = {
        ...body,
        actionId,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }
      const reconcileWorkspace = async (
        batch: ReturnType<typeof generationBatchResponseSchema.parse>
      ) => {
        const first = batch.generations[0]!
        await queryClient.invalidateQueries({
          queryKey: trpc.workspace.get.queryKey({ chatId: body.chatId }),
        })
        const pathFromCache = () =>
          viewPathFromCache(
            queryClient,
            (input) => trpc.workspace.get.queryKey(input),
            body.chatId
          )
        const trySoftFollow = (path: NodeRow[]) =>
          shouldSoftFollow(body, path, selectedChatIdRef.current)
        let didSoftFollow = options?.suppressSelectionFollow
          ? false
          : trySoftFollow(pathFromCache())
        if (!didSoftFollow && !options?.suppressSelectionFollow) {
          const fresh = await queryClient.fetchQuery(
            trpc.workspace.get.queryOptions({ chatId: body.chatId })
          )
          const path = fresh.chat
            ? resolveActivePath(fresh.nodes, fresh.chat.selected_root_node_id)
            : []
          didSoftFollow = trySoftFollow(path)
        }
        if (didSoftFollow) {
          await selectPathMutation.mutateAsync({
            chatId: body.chatId,
            nodeId: first.assistantNodeId,
          })
        }
        await queryClient.invalidateQueries({
          queryKey: trpc.workspace.get.queryKey({ draft: true }),
        })
        await options?.onWorkspaceReady?.({
          userNodeId: batch.userNodeId,
          assistantNodeId: first.assistantNodeId,
        })
      }
      const onEvent = (
        event: import("@/lib/generation-start").ActionStreamEvent
      ) => {
        if (event.type === "action-started") {
          const batch = generationBatchResponseSchema.parse(event)
          if (
            batch.actionId !== actionId ||
            batch.generations.length !== expectedCount
          )
            throw new Error("Generation action returned unexpected replies")
          if (manifestSeen) return
          manifestSeen = true
          const cached = queryClient.getQueryData<WorkspaceData>(
            trpc.workspace.get.queryKey({ chatId: body.chatId })
          )
          for (const {
            generationId,
            assistantNodeId,
            parentNodeId,
          } of batch.generations) {
            started.set(generationId, controller)
            attachController(generationId, controller)
            startStream(generationId, {
              nodeId: assistantNodeId,
              chatId: body.chatId,
              parentNodeId,
              parts: durablePartsForNode(cached?.nodes, assistantNodeId),
            })
          }
          options?.onStreamStarted?.({
            userNodeId: batch.userNodeId,
            assistantNodeId: batch.generations[0]!.assistantNodeId,
          })
          reconcile = reconcileWorkspace(batch)
          void reconcile.catch(() => {})
        } else if (event.type === "generation-event") {
          if (!started.has(event.generationId)) return
          if (event.event.type === "terminal") {
            const task = applyTerminalHandoff(
              event.generationId,
              event.event,
              controller
            )
            void task.catch(() => {})
            terminalTasks.push(task)
          } else applyStreamEvent(event.generationId, event.event)
        }
      }
      let firstConnection = true
      let postAttempts = 0
      let disconnects = 0
      let receiptExpired = false
      while (!controller.signal.aborted) {
        const isPost = firstConnection
        let response: Response
        try {
          response = await fetch(
            isPost
              ? "/api/chat/generations"
              : `/api/chat/generations/${encodeURIComponent(actionId)}/events${actionCursor ? `?cursor=${encodeURIComponent(actionCursor)}` : ""}`,
            isPost
              ? {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(requestBody),
                  signal: controller.signal,
                }
              : { signal: controller.signal }
          )
        } catch (error) {
          if (controller.signal.aborted) break
          if (isPost && ++postAttempts <= 2) continue
          throw error
        }
        if (isPost && response.status >= 500 && ++postAttempts <= 2) {
          await response.body?.cancel()
          continue
        }
        firstConnection = false
        // Completed replies outlive the action receipt and are in the workspace.
        if (!isPost && response.status === 404 && manifestSeen) {
          await response.body?.cancel()
          receiptExpired = true
          break
        }
        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(
            payload.error || `Generation action failed (${response.status})`
          )
        }
        const finished = await readActionEvents(response.body, {
          onEvent,
          onCursor: (cursor) => {
            actionCursor = cursor
          },
        }).catch((error) => {
          if (error instanceof TypeError) return false
          throw error
        })
        if (finished) break
        await new Promise((resolve) =>
          setTimeout(resolve, generationRetryDelay(disconnects++))
        )
      }
      if (controller.signal.aborted) return false
      if (!manifestSeen) throw new Error("Generation action did not start")
      await Promise.allSettled(terminalTasks)
      if (receiptExpired) {
        await queryClient.invalidateQueries({
          queryKey: trpc.workspace.get.queryKey({ chatId: body.chatId }),
        })
        const workspace = await queryClient.fetchQuery(
          trpc.workspace.get.queryOptions({ chatId: body.chatId })
        )
        for (const [generationId, reader] of started) {
          const meta = useStreamStore.getState().streams[generationId]
          if (!meta) continue
          const node = workspace.nodes.find((item) => item.id === meta.nodeId)
          if (node?.status === "streaming")
            throw new Error(
              "Generation receipt expired while a reply is active"
            )
          await applyTerminalHandoff(
            generationId,
            {
              type: "terminal",
              result: node?.status ?? "deleted",
              node: node ?? null,
            },
            reader
          )
        }
      }
      if (reconcile) await reconcile
    } catch (error) {
      failed = true
      if (aliveRef.current)
        toast.error(
          error instanceof Error ? error.message : "Generation failed"
        )
      await queryClient.invalidateQueries({
        queryKey: trpc.workspace.get.queryKey({ chatId: body.chatId }),
      })
      for (const [generationId, controller] of started)
        if (useStreamStore.getState().streams[generationId])
          applyStreamEnd(generationId, "failed", controller)
    } finally {
      if (aliveRef.current)
        setInFlightCount((n) => Math.max(0, n - expectedCount))
    }
    return !failed
  }

  async function runGenerationBatch(
    body: GenerationStartInput,
    count: number,
    options?: Parameters<typeof runGenerationAction>[1]
  ) {
    assertGenerationCount(count)
    if (body.intent === "resume") return runGenerationAction(body, options)
    return runGenerationAction({ ...body, replyCount: count }, options)
  }

  async function ensureChatId(): Promise<{ chatId: string; created: boolean }> {
    if (data.chat?.id) return { chatId: data.chat.id, created: false }
    if (selectedChatId) return { chatId: selectedChatId, created: false }
    // Draft already created this mount (pending replace / second send).
    if (mode === "draft" && selectedChatIdRef.current) {
      return { chatId: selectedChatIdRef.current, created: false }
    }

    // Serialize draft creates so parallel first-sends don't open two chats.
    // Only the waiter that opens the lock reports created: true.
    let ownsCreate = false
    if (!createChatLock.current) {
      ownsCreate = true
      const createInput = {
        settings: draftSettings,
        spaceId: draftSpaceId,
        contextBookIds: draftContextBookIds,
        ...(draftSettings.expandMessageMacros
          ? { expandMessageMacros: true }
          : {}),
      }
      createChatLock.current = materializeTemplateMutation
        .mutateAsync({
          ...createInput,
          ...(draftTemplateId ? { templateId: draftTemplateId } : {}),
          document: draftTemplateDocument,
          draftId: draftMaterializationId.current,
          selectedRootId: draftTemplateRootId,
          selectedChildren: Object.fromEntries(
            draftTemplateNodes.map((node) => [node.id, node.selected_child_id])
          ),
        })
        .then(({ chat, nodes: createdNodes, nodeIds }) => {
          draftNodeIdMap.current = nodeIds
          // Track the new id before replace so stream UI still matches on /chat/new.
          selectedChatIdRef.current = chat.id
          setPendingChatId(chat.id)
          const payload: WorkspaceData = {
            chats: [chat, ...knownChats.filter((c) => c.id !== chat.id)],
            spaces: workspace.spaces,
            chatDefaults: workspace.chatDefaults,
            defaultPromptStackId: workspace.defaultPromptStackId,
            chat,
            nodes: createdNodes,
            activeGenerations: [],
          }
          queryClient.setQueryData(
            trpc.workspace.get.queryKey({ chatId: chat.id }),
            payload
          )
          queryClient.setQueryData(
            trpc.workspace.get.queryKey({ draft: true }),
            {
              chats: payload.chats,
              spaces: payload.spaces,
              chat: null,
              nodes: [],
              activeGenerations: [],
            }
          )
          return chat.id
        })
        .finally(() => {
          createChatLock.current = null
        })
    }
    const id = await createChatLock.current
    return { chatId: id, created: ownsCreate }
  }

  async function resolveDraftMessageOperation(
    operation: MessageMutationOperation
  ): Promise<MessageMutationOperation> {
    if (data.chat) return operation
    const ensured = await ensureChatId()
    if (ensured.created)
      router.replace(`/chat/${ensured.chatId}`, { scroll: false })
    const remap = (nodeId: string | null | undefined) =>
      nodeId ? (draftNodeIdMap.current[nodeId] ?? nodeId) : nodeId
    if (operation.kind === "context")
      return {
        ...operation,
        chatId: ensured.chatId,
        input: { ...operation.input, nodeId: remap(operation.input.nodeId)! },
      }
    if (operation.kind === "move")
      return {
        ...operation,
        input: {
          ...operation.input,
          nodeId: remap(operation.input.nodeId)!,
          destinationParentId:
            remap(operation.input.destinationParentId) ?? null,
          ...(operation.input.beforeNodeId
            ? { beforeNodeId: remap(operation.input.beforeNodeId)! }
            : {}),
        },
      }
    if (operation.kind === "fork")
      return {
        kind: "fork",
        input: { ...operation.input, nodeId: remap(operation.input.nodeId)! },
      }
    if (operation.kind === "replace")
      return {
        kind: "replace",
        input: { ...operation.input, nodeId: remap(operation.input.nodeId)! },
      }
    return {
      kind: "delete",
      input: { ...operation.input, nodeId: remap(operation.input.nodeId)! },
    }
  }

  /**
   * Composer attach target for the Linear dock.
   * When the path tip is awaiting tool input (e.g. questionnaire), send as a
   * sibling under the tip's parent so an unfinished Q&A is not buried under
   * a new user message child.
   */
  const composerParentId = useMemo(() => {
    const tip = activePath.at(-1)
    if (!tip) return null
    if (tip.role === "assistant" && tip.status === "awaiting_input") {
      return tip.parent_id
    }
    return tip.id
  }, [activePath])

  async function streamSubmit(count = 1) {
    const { text, attachments } = readComposerDraft(linearComposerSlot)
    const content = text.trim()
    const generateOnly = !content && attachments.length === 0
    if (attachments.some((attachment) => attachment.uploading)) return
    if (!ensureModelReady(activeModelConfig)) return

    const contextLeafId = composerParentId
    const modelConfig = activeModelConfig
    const pendingAttachments = [...attachments]

    let ensuredId: string | null = null
    let created = false
    try {
      const ensured = await ensureChatId()
      ensuredId = ensured.chatId
      created = ensured.created
      // Start the stream before URL replace so remount sees Zustand state.
      await runGenerationBatch(
        generateOnly
          ? {
              chatId: ensuredId,
              intent: "generate",
              parentNodeId: created
                ? contextLeafId
                  ? (draftNodeIdMap.current[contextLeafId] ?? null)
                  : null
                : contextLeafId,
              attachSelection: true,
            }
          : {
              chatId: ensuredId,
              intent: "submit",
              parentNodeId: created
                ? contextLeafId
                  ? (draftNodeIdMap.current[contextLeafId] ?? null)
                  : null
                : contextLeafId,
              content,
              attachSelection: true,
              ...(pendingAttachments.length
                ? {
                    attachments: pendingAttachments.map(
                      (item) => item.reference
                    ),
                  }
                : {}),
            },
        count,
        {
          modelConfig,
          onStreamStarted: () => {
            if (!generateOnly)
              updateSessionDraft(
                linearComposerSlot,
                clearSubmittedComposerDraft(
                  readComposerDraft(linearComposerSlot),
                  text,
                  pendingAttachments
                )
              )
            if (created) {
              // Let the originating click finish before the route transition
              // replaces the draft composer. A response can arrive during
              // the click's stability window, which otherwise detaches the
              // Send button and makes Playwright (and real pointer users)
              // retry against a disabled node.
              setTimeout(() => {
                if (!aliveRef.current) return
                router.replace(`/chat/${ensuredId}`)
              }, 50)
            }
          },
        }
      )
    } catch (error) {
      if (aliveRef.current) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not start conversation"
        )
      }
    }
  }

  function openScheduleComposer(slot: string, parentId: string | null) {
    setScheduleSource({ slot, parentId, draft: readComposerDraft(slot) })
    setScheduleSendClock({ ...defaultScheduleClock(), kind: "once" })
    setScheduleSendReplyCount(1)
    setScheduleSendOpen(true)
  }

  function openTemplateSchedule(slot: string, parentId: string | null) {
    const draft = readComposerDraft(slot)
    if (!draft.text.trim() && draft.attachments.length === 0) return
    const chatId = data.chat?.id ?? null
    setTemplateScheduleSource({
      slot,
      parentId,
      chatId,
      document: chatId
        ? null
        : chatTemplateFromNodes(
            draftTemplateNodes,
            draftTemplateRootId,
            Boolean(draftSettings.expandMessageMacros)
          ),
      draft,
    })
    setTemplateScheduleName(
      data.chat?.title?.trim() || generationScheduleName(draft.text)
    )
    setTemplateScheduleClock(defaultScheduleClock(spaceId))
    setTemplateScheduleReplyCount(1)
    setTemplateScheduleOpen(true)
  }

  async function submitTemplateSchedule() {
    const source = templateScheduleSource
    if (!source || !templateScheduleName.trim()) return
    if (source.draft.attachments.some((item) => item.uploading)) return
    const error = scheduleClockError(templateScheduleClock)
    const cadence = cadenceFromClock(templateScheduleClock)
    if (error || !cadence) {
      toast.error(error ?? "Enter a time")
      return
    }
    try {
      await sendAndScheduleTemplateMutation.mutateAsync({
        source: source.chatId
          ? { kind: "chat", chatId: source.chatId, parentId: source.parentId }
          : {
              kind: "draft",
              document: source.document!,
              parentId: source.parentId,
              chatOverrides: draftSettings,
            },
        parts: source.draft.text.trim()
          ? [{ type: "text", text: source.draft.text.trim() }]
          : [],
        attachments: source.draft.attachments.map((item) => item.reference),
        name: templateScheduleName.trim(),
        spaceId: templateScheduleClock.spaceId,
        cadence,
        replyCount: templateScheduleReplyCount,
      })
      if (source.chatId) {
        updateSessionDraft(
          source.slot,
          clearSubmittedComposerDraft(
            readComposerDraft(source.slot),
            source.draft.text,
            source.draft.attachments
          )
        )
      } else {
        selectDraftTemplate(null)
        clearSessionChat(null)
        setDraftSettings({})
        setDraftContextBookIds([])
        setDraftSpaceId(null)
      }
      await Promise.all([
        queryClient.invalidateQueries(
          trpc.workspace.listChatTemplates.queryFilter()
        ),
        queryClient.invalidateQueries(
          trpc.workspace.listSchedules.queryFilter()
        ),
        queryClient.invalidateQueries(trpc.workspace.get.queryFilter()),
      ])
      setTemplateScheduleOpen(false)
      toast.success("Template and schedule created")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not schedule template"
      )
    }
  }

  async function scheduleComposer() {
    if (!scheduleSource) return
    const { draft, slot, parentId: sourceParentId } = scheduleSource
    if (draft.attachments.some((attachment) => attachment.uploading)) return
    const cadence = cadenceFromClock(scheduleSendClock)
    if (!cadence || cadence.kind !== "once") {
      toast.error("Choose a future date and time")
      return
    }
    const hasDraft = Boolean(draft.text.trim() || draft.attachments.length)
    try {
      const ensured = await ensureChatId()
      const parentId =
        ensured.created && sourceParentId
          ? (draftNodeIdMap.current[sourceParentId] ?? null)
          : sourceParentId
      if (hasDraft) {
        await createMessageMutation.mutateAsync({
          chatId: ensured.chatId,
          parentId,
          role: "user",
          parts: draft.text.trim()
            ? [{ type: "text", text: draft.text.trim() }]
            : [],
          attachments: draft.attachments.map((item) => item.reference),
          attachSelection: true,
          schedule: {
            name: generationScheduleName(draft.text),
            at: cadence.at,
            timeZone: cadence.timeZone,
            replyCount: scheduleSendReplyCount,
          },
        })
        if (slot)
          updateSessionDraft(
            slot,
            clearSubmittedComposerDraft(
              readComposerDraft(slot),
              draft.text,
              draft.attachments
            )
          )
      } else {
        if (!parentId) {
          toast.error("A generation can only be scheduled from a user message.")
          return
        }
        const anchor = renderNodes.find((node) => node.id === parentId)
        await createChatScheduleMutation.mutateAsync({
          name: anchor
            ? generationScheduleNameFromParts(anchor.parts_json)
            : "Generation",
          chatId: ensured.chatId,
          parentId,
          at: cadence.at,
          timeZone: cadence.timeZone,
          replyCount: scheduleSendReplyCount,
        })
      }
      await Promise.all([
        queryClient.invalidateQueries(
          trpc.workspace.listSchedules.queryFilter()
        ),
        queryClient.invalidateQueries(trpc.workspace.get.queryFilter()),
      ])
      setScheduleSendOpen(false)
      toast.success("Generation scheduled")
      if (ensured.created) router.replace(`/chat/${ensured.chatId}`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not schedule message"
      )
    }
  }

  async function uploadFiles(slot: string, files: FileList | File[]) {
    const read = () => readComposerDraft(slot)
    const writeAttachments = (next: ComposerAttachment[]) => {
      updateSessionDraft(slot, { attachments: next })
    }
    const all = Array.from(files)
    const supported = all.filter(
      (file) =>
        file.type.startsWith("image/") ||
        isPdfFile(file) ||
        file.type === "" ||
        file.type === "application/octet-stream"
    )
    if (supported.length !== all.length)
      toast.error("Only images and PDFs can be attached")
    const selected = supported.filter(
      (file) => file.size <= MAX_FILE_ATTACHMENT_BYTES
    )
    if (selected.length !== supported.length)
      toast.error("Files must be 10 MiB or smaller")
    if (!selected.length) return
    const fileCount = read().attachments.filter(
      (item) => item.reference.kind === "uploaded-file"
    ).length
    if (fileCount + selected.length > MAX_FILE_ATTACHMENTS) {
      toast.error("You can attach up to four files")
      return
    }
    const placeholders: ComposerAttachment[] = selected.map((file) => ({
      name: file.name,
      mediaType: isPdfFile(file) ? "application/pdf" : file.type,
      ...(file.type.startsWith("image/")
        ? { previewUrl: URL.createObjectURL(file) }
        : {}),
      uploading: true,
      reference: { kind: "uploaded-file", id: crypto.randomUUID() },
    }))
    writeAttachments([...read().attachments, ...placeholders])
    for (const [index, file] of selected.entries()) {
      const part = placeholders[index]!
      const localId =
        part.reference.kind === "uploaded-file" ? part.reference.id : ""
      const previewUrl = part.previewUrl
      try {
        const form = new FormData()
        form.set("file", file)
        const response = await fetch("/api/attachments", {
          method: "POST",
          body: form,
        })
        const payload = (await response.json().catch(() => ({}))) as {
          id?: string
          filename?: string
          mediaType?: string
          error?: string
        }
        if (!response.ok || !payload.id)
          throw new Error(payload.error || "File upload failed")
        if (!aliveRef.current || cancelledUploadIds.current.has(localId)) {
          void fetch(`/api/attachments/${payload.id}`, { method: "DELETE" })
          if (previewUrl) URL.revokeObjectURL(previewUrl)
          continue
        }
        let pdfAnalysis: PdfAnalysis | undefined
        if (payload.mediaType === "application/pdf") {
          pdfAnalysis = await analyzePdf(file)
          const analysisResponse = await fetch(
            `/api/attachments/${payload.id}`,
            {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(pdfAnalysis),
            }
          )
          if (!analysisResponse.ok) {
            toast.error("PDF attached, but text could not be read")
            pdfAnalysis = undefined
          }
        }
        writeAttachments(
          read().attachments.map((item) =>
            item.reference.kind === "uploaded-file" &&
            item.reference.id === localId
              ? {
                  ...item,
                  name: payload.filename ?? item.name,
                  mediaType: payload.mediaType ?? item.mediaType,
                  reference: {
                    kind: "uploaded-file" as const,
                    id: payload.id!,
                  },
                  ...(pdfAnalysis ? { pdfAnalysis } : {}),
                  uploading: false,
                }
              : item
          )
        )
      } catch (error) {
        if (aliveRef.current) {
          writeAttachments(
            read().attachments.filter(
              (item) =>
                item.reference.kind !== "uploaded-file" ||
                item.reference.id !== localId
            )
          )
          if (previewUrl) URL.revokeObjectURL(previewUrl)
          if (viewer?.src === previewUrl) setViewer(null)
          toast.error(
            error instanceof Error ? error.message : "File upload failed"
          )
        }
      }
    }
  }

  function removeAttachment(slot: string, part: ComposerAttachment) {
    if (part.uploading && part.reference.kind === "uploaded-file")
      cancelledUploadIds.current.add(part.reference.id)
    if (part.previewUrl && viewer?.src === part.previewUrl) setViewer(null)
    const current = readComposerDraft(slot)
    const next = current.attachments.filter((item) => item !== part)
    updateSessionDraft(slot, { attachments: next })
    if (part.previewUrl) revokeComposerPreviewUrl(part.previewUrl)
    if (
      shouldDeleteUploadedAttachment(part) &&
      part.reference.kind === "uploaded-file"
    )
      void fetch(`/api/attachments/${part.reference.id}`, { method: "DELETE" })
  }

  async function streamRepliesFromNode(nodeId: string | null, count = 1) {
    const ensured = await ensureChatId()
    const persistedNodeId = nodeId
      ? ensured.created
        ? (draftNodeIdMap.current[nodeId] ?? nodeId)
        : nodeId
      : null
    await runGenerationBatch(
      {
        chatId: ensured.chatId,
        intent: "generate",
        parentNodeId: persistedNodeId,
        attachSelection: true,
      },
      count,
      ensured.created
        ? {
            onStreamStarted: () =>
              router.replace(`/chat/${ensured.chatId}`, { scroll: false }),
          }
        : undefined
    )
  }

  function treeSlot(anchor: string | null) {
    return composerSlotId(data.chat?.id ?? selectedChatId, "tree", anchor)
  }

  function openTreeDraft(anchor: string | null) {
    const slot = treeSlot(anchor)
    if (!hasComposerDraft(slot)) updateSessionDraft(slot, { text: "" })
  }

  function closeTreeDraft(
    anchor: string | null,
    mode: "discard" | "sent" = "discard"
  ) {
    const slot = treeSlot(anchor)
    const draft = readComposerDraft(slot)
    for (const attachment of draft.attachments) {
      if (attachment.previewUrl) revokeComposerPreviewUrl(attachment.previewUrl)
      if (mode === "sent") continue
      removeAttachment(slot, attachment)
    }
    clearSessionDraft(slot)
  }

  function closeMessageEdit(
    node: NodeRow,
    mode: "discard" | "sent" = "discard"
  ) {
    const slot = messageEditSlotId(node.chat_id, node.id)
    const draft = readComposerDraft(slot)
    for (const attachment of draft.attachments) {
      if (mode === "sent") {
        revokeComposerPreviewUrl(attachment.previewUrl)
        continue
      }
      removeAttachment(slot, attachment)
    }
    clearSessionDraft(slot)
  }

  function finishComposeHandoff(anchor: string | null) {
    closeTreeDraft(anchor, "sent")
    setComposeMorphs((current) => {
      const want = composeLayoutId(anchor)
      const next = { ...current }
      for (const [nodeId, layoutId] of Object.entries(next)) {
        if (layoutId === want) delete next[nodeId]
      }
      return next
    })
  }

  async function streamTreeSend(parentNodeId: string | null, count = 1) {
    const slot = treeSlot(parentNodeId)
    const draft = readComposerDraft(slot)
    const content = draft.text.trim()
    if (draft.attachments.some((attachment) => attachment.uploading))
      return false
    const role = treeComposerRoles[parentNodeId ?? "root"] ?? "user"
    if (!content && draft.attachments.length === 0) {
      if (role !== "user") return false
      if (!ensureModelReady(activeModelConfig)) return false
      const ensured = await ensureChatId()
      const persistedParentId = parentNodeId
        ? (draftNodeIdMap.current[parentNodeId] ?? parentNodeId)
        : null
      const treeChatId = ensured.chatId
      return new Promise<boolean>((resolve) => {
        let started = false
        let settled = false
        const finish = (ok: boolean) => {
          if (settled) return
          settled = true
          resolve(ok)
        }
        void runGenerationBatch(
          {
            chatId: treeChatId,
            intent: "generate",
            parentNodeId: persistedParentId,
          },
          count,
          {
            suppressSelectionFollow: true,
            onStreamStarted: () => {
              started = true
              closeTreeDraft(parentNodeId, "sent")
              finish(true)
            },
          }
        ).then(() => finish(started))
      })
    }
    if (role === "assistant") {
      if (draft.attachments.length) {
        toast.error("Assistant messages cannot contain attachments.")
        return false
      }
      const ensured = await ensureChatId()
      const persistedParentId = parentNodeId
        ? (draftNodeIdMap.current[parentNodeId] ?? parentNodeId)
        : null
      try {
        await createMessageMutation.mutateAsync({
          chatId: ensured.chatId,
          parentId: persistedParentId,
          role,
          parts: [{ type: "text", text: content }],
          attachSelection: false,
        })
        updateSessionDraft(slot, { text: "", attachments: [] })
        await invalidateWorkspace()
        if (ensured.created)
          router.replace(`/chat/${ensured.chatId}`, { scroll: false })
        return true
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not save message"
        )
        return false
      }
    }
    if (!ensureModelReady(activeModelConfig)) return false
    const ensured = await ensureChatId()
    const persistedParentId = parentNodeId
      ? (draftNodeIdMap.current[parentNodeId] ?? parentNodeId)
      : null
    const treeChatId = ensured.chatId
    const pendingAttachments = [...draft.attachments]
    updateSessionDraft(slot, {
      attachments: pendingAttachments.map((item) => ({
        ...item,
        claimed: true,
      })),
    })
    return new Promise<boolean>((resolve) => {
      let started = false
      let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        resolve(ok)
      }
      void runGenerationBatch(
        {
          chatId: treeChatId,
          intent: "submit",
          parentNodeId: persistedParentId,
          content,
          ...(pendingAttachments.length
            ? {
                attachments: pendingAttachments.map((item) => item.reference),
              }
            : {}),
        },
        count,
        {
          suppressSelectionFollow: true,
          onStreamStarted: ({ userNodeId }) => {
            started = true
            if (userNodeId) {
              setComposeMorphs((current) => ({
                ...current,
                [userNodeId]: composeLayoutId(parentNodeId),
              }))
            }
          },
          onWorkspaceReady: () => {
            if (ensured.created)
              router.replace(`/chat/${ensured.chatId}`, { scroll: false })
            finish(true)
          },
        }
      ).then(() => {
        if (!started) {
          const current = readComposerDraft(slot)
          updateSessionDraft(slot, {
            attachments: current.attachments.map((item) => ({
              ...item,
              claimed: false,
            })),
          })
        }
        finish(started)
      })
    })
  }

  async function streamEditSend(node: NodeRow) {
    const slot = messageEditSlotId(node.chat_id, node.id)
    if (isEditorSending(slot)) return false
    const session = useConversationSessionStore.getState().sessions[slot]
    if (!session) return false
    if (session.role === "user" && !ensureModelReady(activeModelConfig))
      return false
    const authored = authoredPartsFromSession(session)
    const parts = durableAuthoredParts(authored.parts)
    if (isEmptyParts(parts) && authored.attachments.length === 0) return false
    if (parts.length > 0 && !messagePartsSchema.safeParse(parts).success)
      return false
    if (session.attachments.some((attachment) => attachment.uploading))
      return false
    let chatId = data.chat?.id ?? null
    const pendingAttachments = [...session.attachments]
    setSessionSending(slot, true)
    updateSessionDraft(slot, {
      attachments: pendingAttachments.map((item) => ({
        ...item,
        claimed: true,
      })),
    })
    let persisted = false
    try {
      const ensured = await ensureChatId()
      chatId = ensured.chatId
      const persistedNodeId = ensured.created
        ? (draftNodeIdMap.current[node.id] ?? node.id)
        : node.id
      const forked = await forkMessagePartsMutation.mutateAsync({
        nodeId: persistedNodeId,
        parts,
        attachments: authored.attachments,
        role: session.role,
        attachSelection: view === "linear",
      })
      persisted = true
      // The authored branch is durable now; close the editor before starting
      // generation so a retry cannot fork the same draft again.
      closeMessageEdit(node, "sent")
      if (session.role === "assistant") {
        await invalidateWorkspace()
        if (ensured.created)
          router.replace(`/chat/${ensured.chatId}`, { scroll: false })
        return true
      }
      let started = false
      await runGenerationAction(
        {
          chatId: chatId,
          intent: "generate",
          parentNodeId: forked.id,
          attachSelection: view === "linear",
        },
        {
          suppressSelectionFollow: true,
          onStreamStarted: () => {
            started = true
            if (ensured.created)
              router.replace(`/chat/${ensured.chatId}`, { scroll: false })
          },
          onWorkspaceReady: async ({ assistantNodeId }) => {
            if (view === "linear")
              await selectPathMutation.mutateAsync({
                chatId: chatId!,
                nodeId: assistantNodeId,
              })
          },
        }
      )
      if (!started) throw new Error("Generation did not start")
      return true
    } catch (error) {
      if (!persisted)
        updateSessionDraft(slot, {
          attachments: pendingAttachments,
        })
      toast.error(
        error instanceof Error ? error.message : "Could not save and generate"
      )
      return false
    } finally {
      if (hasComposerDraft(slot)) setSessionSending(slot, false)
    }
  }

  async function streamTreeRepliesFromNode(nodeId: string | null, count = 1) {
    const ensured = await ensureChatId()
    const persistedNodeId = nodeId
      ? ensured.created
        ? (draftNodeIdMap.current[nodeId] ?? nodeId)
        : nodeId
      : null
    await runGenerationBatch(
      {
        chatId: ensured.chatId,
        intent: "generate",
        parentNodeId: persistedNodeId,
        attachSelection: false,
      },
      count,
      {
        suppressSelectionFollow: true,
        ...(ensured.created
          ? {
              onStreamStarted: () =>
                router.replace(`/chat/${ensured.chatId}`, { scroll: false }),
            }
          : {}),
      }
    )
  }

  async function streamResume(
    assistantNodeId: string,
    toolResults: Array<{ toolCallId: string; output: unknown }>
  ) {
    if (!data.chat) return
    await runGenerationAction({
      chatId: data.chat.id,
      intent: "resume",
      assistantNodeId,
      toolResults,
    })
  }

  async function streamTreeResume(
    assistantNodeId: string,
    toolResults: Array<{ toolCallId: string; output: unknown }>
  ) {
    if (!data.chat) return
    await runGenerationAction(
      { chatId: data.chat.id, intent: "resume", assistantNodeId, toolResults },
      { suppressSelectionFollow: true }
    )
  }

  const setModelMutation = useMutation(
    trpc.workspace.setModel.mutationOptions({
      onSuccess: async () => {
        await invalidateWorkspace()
      },
    })
  )
  const setChatSpaceMutation = useMutation(
    trpc.workspace.setChatSpace.mutationOptions({
      onSuccess: async () => {
        await invalidateWorkspace()
        toast.success("Moved")
      },
      onError: (error) => toast.error(error.message || "Could not move chat"),
    })
  )

  async function commitModelConfig(next: ModelConfigLocal) {
    if (data.chat) {
      await setModelMutation.mutateAsync({
        chatId: data.chat.id,
        config: next,
      })
      return
    }
    const overrides = generationOverrides(
      next,
      inheritedSettings.effective.model
    )
    setDraftSettings((current) => replaceGenerationSlice(current, overrides))
  }

  function assignDraftSpace(next: string | null) {
    setDraftSpaceId(next)
    if (mode !== "draft") return
    const url = next
      ? `/chat/new?space=${encodeURIComponent(next)}`
      : "/chat/new"
    window.history.replaceState(window.history.state, "", url)
  }

  const streamsForActiveChat = chatStreamEntries(streamMetas, [
    selectedChatId,
    // On /chat/new after first create, selectedChatId is still null.
    pendingChatId,
    data.chat?.id,
  ])

  const pathVisibleStreams = streamsForActiveChat.filter(([, stream]) => {
    const place = streamPlacement(stream, activePath, nodes)
    return place === "inline" || place === "after-tip"
  })

  const streamIdByNodeId = new Map<string, string>()
  for (const [streamId, stream] of streamsForActiveChat) {
    streamIdByNodeId.set(stream.nodeId, streamId)
  }

  const afterTipStreams = streamsForActiveChat
    .filter(
      ([, stream]) => streamPlacement(stream, activePath, nodes) === "after-tip"
    )
    .map(([streamId, stream]) => ({ streamId, nodeId: stream.nodeId }))

  const showEmpty =
    activePath.length === 0 &&
    pathVisibleStreams.length === 0 &&
    inFlightCount === 0

  const chatKey = selectedChatId ?? pendingChatId ?? "draft"
  const ariaBusy = inFlightCount > 0 || pathVisibleStreams.length > 0
  const previewModelConfig = useMemo(
    () => ({
      providerId: activeModelConfig.providerId,
      model: activeModelConfig.model,
      replayReasoning: activeModelConfig.replayReasoning,
      contextScanDepth: activeModelConfig.contextScanDepth,
    }),
    [
      activeModelConfig.providerId,
      activeModelConfig.model,
      activeModelConfig.replayReasoning,
      activeModelConfig.contextScanDepth,
    ]
  )
  const sessionChatId = data.chat?.id ?? "draft"
  const treeSlotSignature = useTreeDraftSlotSignature(sessionChatId)
  const treeDraftAnchors = useMemo(() => {
    const anchors = treeDraftAnchorsForChat(
      useConversationSessionStore.getState().sessions,
      sessionChatId
    )
    // Hide the composer in the same render the user node appears, so layout
    // does not slide the open plus (composer) to the right of the new child.
    for (const [nodeId, layoutId] of Object.entries(composeMorphs)) {
      if (!nodes.some((node) => node.id === nodeId)) continue
      anchors.delete(composeLayoutAnchor(layoutId))
    }
    return anchors
  }, [sessionChatId, nodes, treeSlotSignature, composeMorphs])
  const editSlotSignature = useMessageEditSlotSignature(sessionChatId)
  const editingNodeIds = useMemo(() => {
    if (!editSlotSignature) return new Set<string>()
    return messageEditNodeIdsForChat(
      useConversationSessionStore.getState().sessions,
      sessionChatId
    )
  }, [sessionChatId, editSlotSignature])

  const showTemplatePicker =
    !data.chat &&
    (templateOptions.length > 0 ||
      Boolean(draftTemplateId) ||
      Boolean(settingLocks.chatTemplate))
  const templatePickerLabel = chatTemplatePickerLabel(
    templateOptions,
    draftTemplateId
  )

  const messageEditor: MessageEditorBindings = {
    mcpAvailable: mcpAvailableForGeneration,
    animate: animate && transition.duration > 0,
    onSend: streamEditSend,
    onCancel: (node) => closeMessageEdit(node),
    onFinishEdit: closeMessageEdit,
    onFiles: (slot, files) => void uploadFiles(slot, files),
    onRemoveAttachment: (slot, part) => removeAttachment(slot, part),
    onPreview: (src, name) => setViewer({ src, name }),
    onOpenResources: (slot) => {
      setPickerSlot(slot)
      setResourcePickerOpen(true)
    },
    onOpenPrompts: (slot) => {
      setPickerSlot(slot)
      setPromptPickerOpen(true)
    },
    onRevealContextMessage: setScrollTargetId,
  }

  const leafIsUser = activePath.at(-1)?.role === "user"
  const pendingGenerations = useMemo(() => {
    const rows: PendingGeneration[] = []
    for (const parent of renderNodes) {
      if (parent.role !== "user" || !parent.schedules?.length) continue
      for (const schedule of parent.schedules) {
        rows.push({
          id: schedule.id,
          parentId: parent.id,
          nextRunAt: schedule.nextRunAt,
          timeZone: schedule.timeZone,
          replyCount: schedule.replyCount ?? 1,
        })
      }
    }
    return rows
  }, [renderNodes])
  const openPendingGeneration = useCallback((scheduleId: string) => {
    setEditingScheduleId(scheduleId)
  }, [])
  const cancelPendingGeneration = useCallback((scheduleId: string) => {
    setScheduleToCancel(scheduleId)
  }, [])
  const editingSchedule = useMemo(() => {
    if (!editingScheduleId) return null
    for (const node of renderNodes) {
      const schedule = node.schedules?.find(
        (item) => item.id === editingScheduleId
      )
      if (schedule) return schedule
    }
    return null
  }, [editingScheduleId, renderNodes])
  const openGenerationForNode = useCallback((nodeId: string) => {
    setScheduleSource({
      slot: null,
      parentId: nodeId,
      draft: { text: "", attachments: [] },
    })
    setScheduleSendClock({ ...defaultScheduleClock(), kind: "once" })
    setScheduleSendReplyCount(1)
    setScheduleSendOpen(true)
  }, [])
  const scheduledGeneration = useMemo(
    () => ({
      available: schedulesQuery.data?.available === true,
      pending: pendingGenerations,
      openForNode: openGenerationForNode,
      openPending: openPendingGeneration,
      cancel: cancelPendingGeneration,
    }),
    [
      cancelPendingGeneration,
      openGenerationForNode,
      openPendingGeneration,
      pendingGenerations,
      schedulesQuery.data?.available,
    ]
  )
  const canSchedule =
    !template &&
    leafIsUser &&
    schedulesQuery.data?.available === true &&
    inFlightCount === 0

  function submitSaveTemplate() {
    if (
      !data.chat ||
      !saveTemplateName.trim() ||
      saveTemplateMutation.isPending ||
      scheduleFromChatMutation.isPending
    )
      return
    if (inFlightCount > 0) {
      toast.error("Wait for replies to finish before saving a template")
      return
    }
    const existing = templatesQuery.data?.find(
      (template) => template.id === replaceTemplateId
    )
    const name = saveTemplateName.trim()
    if (scheduleEnabled && canSchedule) {
      const clockError = scheduleClockError(scheduleClock)
      if (clockError) {
        toast.error(clockError)
        return
      }
      const cadence = cadenceFromClock(scheduleClock)
      if (!cadence) {
        toast.error("Enter a time")
        return
      }
      scheduleFromChatMutation.mutate({
        chatId: data.chat.id,
        name,
        spaceId: scheduleClock.spaceId,
        cadence,
        replyCount: scheduleReplyCount,
        ...(existing
          ? {
              templateId: existing.id,
              expectedFingerprint: existing.fingerprint,
            }
          : {}),
      })
      return
    }
    saveTemplateMutation.mutate({
      chatId: data.chat.id,
      name,
      ...(existing
        ? {
            templateId: existing.id,
            expectedFingerprint: existing.fingerprint,
          }
        : {}),
    })
  }

  const schedulePreview = scheduleSource?.draft.text.trim()
    ? scheduleSource.draft.text
    : scheduleSource &&
        scheduleSource.draft.attachments.length === 0 &&
        scheduleSource.parentId
      ? messagePreviewFromParts(
          renderNodes.find((node) => node.id === scheduleSource.parentId)
            ?.parts_json ?? ""
        )
      : ""

  async function submitRename() {
    const next = renameTitle.trim()
    if (!next) return
    if (template) {
      const previous = templateName
      setTemplateName(next)
      try {
        await renameTemplateMutation.mutateAsync({
          templateId: template.id,
          name: next,
        })
        setRenameOpen(false)
      } catch {
        setTemplateName(previous)
      }
      return
    }
    if (!data.chat) return
    await updateChatMutation.mutateAsync({
      chatId: data.chat.id,
      title: next,
    })
    setRenameOpen(false)
  }

  return (
    <ContextPreviewProvider
      nodes={renderNodes}
      chatStackId={effectivePromptStackId}
      draftStackId={effectivePromptStackId}
      hasChat={Boolean(data.chat)}
      chat={
        data.chat
          ? { id: data.chat.id, created_at: data.chat.created_at }
          : undefined
      }
      variableOverrides={resolvedSettings.effective.variables}
      modelConfig={previewModelConfig}
      providers={providers}
      contextBooks={previewContextBooks}
      spaceRulesText={formatSpaceRules(resolvedSettings.effective.rules)}
    >
      <section
        ref={paneRef}
        data-theme-group="chat"
        data-theme-target="chat"
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-chat"
      >
        <DocumentTitle
          title={template ? templateName : displayChatTitle(data.chat?.title)}
        />
        <header
          className={cn(
            "flex shrink-0 flex-col gap-1.5 border-b sm:flex-row sm:items-center sm:gap-2",
            density === "compact" ? "px-3 py-2" : "px-3 py-2.5 sm:px-5",
            template
              ? "sm:h-auto"
              : density === "compact"
                ? "sm:h-12 sm:py-0"
                : "sm:h-14 sm:py-0"
          )}
        >
          <div className="min-w-0 flex-1">
            <h1
              onDoubleClick={() => {
                if (template) {
                  setRenameTitle(templateName)
                  setRenameOpen(true)
                  return
                }
                if (!data.chat) return
                setRenameTitle(data.chat.title ?? "")
                setRenameOpen(true)
              }}
              className={cn("truncate font-medium", data.chat && "cursor-text")}
              title={data.chat ? "Double-click to rename" : undefined}
            >
              {template ? templateName : displayChatTitle(data.chat?.title)}
            </h1>
            {template ? (
              <div className="text-xs text-muted-foreground">
                <p>
                  This is a chat template. The message tree saves as you edit.
                  Chat settings are not included.{" "}
                  <Link
                    href="/settings#chat-templates"
                    className="font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    Chat templates
                  </Link>
                </p>
                {templateUsageLabel ? (
                  <p className="truncate">{templateUsageLabel}</p>
                ) : null}
              </div>
            ) : (
              <p className="hidden truncate text-xs text-muted-foreground sm:block">
                {!data.chat &&
                templateOptions.some(
                  (template) => template.id === draftTemplateId
                )
                  ? `Starting from ${templatePickerLabel}. Send to create the chat.`
                  : "Each reply can become its own direction."}
              </p>
            )}
          </div>
          <div className="flex min-w-0 flex-nowrap items-center gap-0.5 overflow-hidden sm:max-w-[min(44rem,78%)] sm:shrink-0 sm:gap-1">
            {showTemplatePicker ? (
              <div className="hidden min-w-0 md:contents">
                <ChatTemplatePicker
                  templates={templateOptions}
                  value={draftTemplateId}
                  onSelect={requestDraftTemplate}
                  lockedBy={settingLocks.chatTemplate}
                />
              </div>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 gap-1.5"
              disabled={!data.chat && nodes.length === 0}
              aria-label={view === "tree" ? "Linear" : "Tree"}
              onClick={() =>
                setPersistedView((current) =>
                  current === "tree" ? "linear" : "tree"
                )
              }
            >
              <HugeiconsIcon
                icon={view === "tree" ? ListViewIcon : HierarchySquare02Icon}
                strokeWidth={2}
                className="size-3.5"
              />
              <span className="hidden md:inline">
                {view === "tree" ? "Linear" : "Tree"}
              </span>
            </Button>
            <div className="hidden min-w-0 md:contents">
              <PromptStackPicker
                chatId={data.chat?.id}
                promptStackId={storedPromptStackId}
                effectiveStackId={effectivePromptStackId}
                draftStackId={storedPromptStackId}
                onDraftChange={(value) => {
                  setDraftSettings((current) => {
                    const next = { ...current }
                    if (value) next.promptStack = value
                    else delete next.promptStack
                    return next
                  })
                }}
                onChanged={invalidateWorkspace}
                lockedBy={settingLocks.promptStack}
              />
              <ContextBookPicker
                chatId={data.chat?.id}
                spaceId={spaceId}
                spaces={data.spaces}
                draftIds={draftContextBookIds}
                onDraftChange={setDraftContextBookIds}
              />
              <ChatVariablesPicker
                chatId={data.chat?.id}
                promptStackId={effectivePromptStackId}
                draftStackId={effectivePromptStackId}
                variablesJson={JSON.stringify(chatOverrides.variables ?? {})}
                draftValues={
                  (chatOverrides.variables ?? {}) as PromptVariableValues
                }
                effectiveValues={resolvedSettings.effective.variables}
                inheritedValues={inheritedSettings.effective.variables}
                onDraftChange={(values) => {
                  setDraftSettings((current) => {
                    const next = { ...current }
                    if (Object.keys(values).length) next.variables = values
                    else delete next.variables
                    return next
                  })
                }}
                onChanged={invalidateWorkspace}
                lockedVariables={settingLocks.variables}
              />
            </div>
            <div className="min-w-0 flex-1 overflow-hidden">
              <ModelPicker
                config={activeModelConfig}
                chatId={data.chat?.id}
                providers={providers}
                showIds={appearance.modelPicker.showIds}
                onChange={commitModelConfig}
                lockedBy={settingLocks.model}
              />
            </div>
            <ReasoningPicker
              config={activeModelConfig}
              providers={providers}
              onChange={commitModelConfig}
              onEditParameters={() => setParametersOpen(true)}
              lockedBy={settingLocks.reasoning}
            />
            <div className={template ? "hidden" : "hidden min-w-0 md:contents"}>
              <SpacePicker
                spaces={data.spaces ?? []}
                value={spaceId}
                showMembership
                onSelect={(next) => {
                  if (data.chat) {
                    void setChatSpaceMutation.mutateAsync({
                      chatId: data.chat.id,
                      spaceId: next,
                    })
                    return
                  }
                  assignDraftSpace(next)
                }}
              />
            </div>
            <ChatHeaderMore
              compactItems={[
                ...(showTemplatePicker
                  ? [
                      {
                        label: `Template · ${templatePickerLabel}`,
                        onSelect: () => {
                          if (settingLocks.chatTemplate) {
                            router.push(
                              `/space/${settingLocks.chatTemplate.spaceId}`
                            )
                            return
                          }
                          setTemplateOpen(true)
                        },
                      },
                    ]
                  : []),
                {
                  label: "Prompt stack",
                  onSelect: () => {
                    if (settingLocks.promptStack) {
                      router.push(`/space/${settingLocks.promptStack.spaceId}`)
                      return
                    }
                    setStackOpen(true)
                  },
                },
                {
                  label: "Context books",
                  onSelect: () => setBooksOpen(true),
                },
                {
                  label: "Variables",
                  onSelect: () => setVariablesOpen(true),
                },
                ...(!template
                  ? [
                      {
                        label: `Space · ${
                          (data.spaces ?? []).find(
                            (space) => space.id === spaceId
                          )?.name ?? "Ungrouped"
                        }`,
                        onSelect: () => setSpaceOpen(true),
                      },
                    ]
                  : []),
              ]}
              items={[
                ...(data.chat && !template
                  ? [
                      {
                        label: "Save as template",
                        onSelect: () => {
                          setSaveTemplateName(
                            data.chat?.title?.trim() || "New template"
                          )
                          setReplaceTemplateId(SAVE_TEMPLATE_NEW)
                          setScheduleEnabled(false)
                          setScheduleClock(defaultScheduleClock(spaceId))
                          setSaveTemplateOpen(true)
                        },
                      },
                    ]
                  : []),
                {
                  label: "Chat settings",
                  onSelect: () => setParametersOpen(true),
                },
              ]}
            />
          </div>
        </header>
        {showTemplatePicker ? (
          <ChatTemplatePicker
            hideTrigger
            open={templateOpen}
            onOpenChange={setTemplateOpen}
            templates={templateOptions}
            value={draftTemplateId}
            onSelect={requestDraftTemplate}
            lockedBy={settingLocks.chatTemplate}
          />
        ) : null}
        <PromptStackPicker
          hideTrigger
          open={stackOpen}
          onOpenChange={setStackOpen}
          chatId={data.chat?.id}
          promptStackId={storedPromptStackId}
          effectiveStackId={effectivePromptStackId}
          draftStackId={storedPromptStackId}
          onDraftChange={(value) => {
            setDraftSettings((current) => {
              const next = { ...current }
              if (value) next.promptStack = value
              else delete next.promptStack
              return next
            })
          }}
          onChanged={invalidateWorkspace}
          lockedBy={settingLocks.promptStack}
        />
        <ContextBookPicker
          hideTrigger
          open={booksOpen}
          onOpenChange={setBooksOpen}
          chatId={data.chat?.id}
          spaceId={spaceId}
          spaces={data.spaces}
          draftIds={draftContextBookIds}
          onDraftChange={setDraftContextBookIds}
        />
        <ChatVariablesPicker
          hideTrigger
          open={variablesOpen}
          onOpenChange={setVariablesOpen}
          chatId={data.chat?.id}
          promptStackId={effectivePromptStackId}
          draftStackId={effectivePromptStackId}
          variablesJson={JSON.stringify(chatOverrides.variables ?? {})}
          draftValues={(chatOverrides.variables ?? {}) as PromptVariableValues}
          effectiveValues={resolvedSettings.effective.variables}
          inheritedValues={inheritedSettings.effective.variables}
          onDraftChange={(values) => {
            setDraftSettings((current) => {
              const next = { ...current }
              if (Object.keys(values).length) next.variables = values
              else delete next.variables
              return next
            })
          }}
          onChanged={invalidateWorkspace}
          lockedVariables={settingLocks.variables}
        />
        <GenerationParameters
          open={parametersOpen}
          onOpenChange={setParametersOpen}
          key={`${data.chat?.id ?? "draft"}:${activeModelConfig.providerId ?? ""}:${activeModelConfig.model ?? ""}`}
          config={activeModelConfig}
          inherited={inheritedSettings.effective.model}
          chatId={data.chat?.id}
          onChange={commitModelConfig}
          locks={settingLocks}
        />
        <SpacePicker
          hideTrigger
          open={spaceOpen}
          onOpenChange={setSpaceOpen}
          spaces={data.spaces ?? []}
          value={spaceId}
          triggerLabel="Move this chat"
          showMembership
          onSelect={(next) => {
            if (data.chat) {
              void setChatSpaceMutation.mutateAsync({
                chatId: data.chat.id,
                spaceId: next,
              })
              return
            }
            assignDraftSpace(next)
          }}
        />

        <ScheduledGenerationProvider
          value={
            template
              ? { ...scheduledGeneration, available: false, pending: [] }
              : scheduledGeneration
          }
        >
          <MessageLayer
            value={find.layerValue}
            resolveOperation={resolveDraftMessageOperation}
          >
            {view === "linear" ? (
              <ChatTranscript
                chatKey={chatKey}
                density={density}
                activePath={activePath}
                nodes={renderNodes}
                providers={providers}
                streamIdByNodeId={streamIdByNodeId}
                afterTipStreams={afterTipStreams}
                showEmpty={showEmpty}
                emptyHint={
                  showTemplatePicker
                    ? "Or choose a chat template to start from a saved conversation."
                    : undefined
                }
                ariaBusy={ariaBusy}
                animate={animate}
                transition={transition}
                messageActionCaptions={appearance.messageActions.captions}
                editingNodeIds={editingNodeIds}
                scrollTargetId={scrollTargetId}
                onScrollTargetConsumed={consumeScrollTarget}
                findLocateKey={find.locateKey}
                onSelect={(parentId, childId) => {
                  if (!data.chat) {
                    if (parentId)
                      setDraftTemplateNodes((current) =>
                        current.map((node) =>
                          node.id === parentId
                            ? { ...node, selected_child_id: childId }
                            : node
                        )
                      )
                    else setDraftTemplateRootId(childId)
                  } else if (parentId)
                    selectChildMutation.mutate({
                      nodeId: parentId,
                      childId,
                    })
                  else
                    selectRootMutation.mutate({
                      chatId: data.chat.id,
                      nodeId: childId,
                    })
                  // User-driven branch navigation — bring the selected tip into view.
                  setScrollTargetId(childId)
                }}
                onChanged={() => invalidateWorkspace()}
                onGenerateReplies={streamRepliesFromNode}
                onAnswerTools={streamResume}
                editor={messageEditor}
              />
            ) : (
              <ChatTree
                key={chatIdentity}
                nodes={renderNodes}
                activePath={activePath}
                draftAnchors={treeDraftAnchors}
                editingNodeIds={editingNodeIds}
                providers={providers}
                streamIdByNodeId={streamIdByNodeId}
                animate={animate}
                transition={transition}
                messageActionCaptions={appearance.messageActions.captions}
                messageLayoutIds={composeMorphs}
                focusTargetId={scrollTargetId}
                onFocusTargetConsumed={consumeScrollTarget}
                findQuery={find.findOpen ? find.findNeedle : ""}
                searchHitIds={find.searchHitIds}
                findLocate={find.findOpen ? find.findLocate : null}
                onLocateHit={find.locateNode}
                onHandoffComplete={finishComposeHandoff}
                onSendDraft={streamTreeSend}
                renderComposer={(anchor, options) => {
                  const slot = treeSlot(anchor)
                  const role = treeComposerRoles[anchor ?? "root"] ?? "user"
                  return (
                    <div>
                      <ComposerRoleToggle
                        className="mb-1"
                        value={role}
                        onChange={(candidate) =>
                          setTreeComposerRoles((current) => ({
                            ...current,
                            [anchor ?? "root"]: candidate,
                          }))
                        }
                      />
                      <SessionMessageEditor
                        slot={slot}
                        variant="inline"
                        autoFocus={options.autoFocus}
                        submitting={options.submitting}
                        animate={animate && transition.duration > 0}
                        placeholder={
                          role === "user"
                            ? anchor
                              ? "Take this conversation somewhere new…"
                              : "Start a new root…"
                            : "Write an assistant message…"
                        }
                        mcpAvailable={
                          role === "user" && mcpAvailableForGeneration
                        }
                        allowAttachments={role === "user"}
                        streaming={options.submitting}
                        showContextPreview
                        contextParentId={anchor}
                        sendLabel={role === "user" ? "Send" : "Save"}
                        allowEmptySend={role === "user"}
                        onSend={options.onSend}
                        onSendMultiple={
                          role === "user" ? options.onSendMultiple : undefined
                        }
                        onSchedule={
                          role === "user" && !template
                            ? () => openScheduleComposer(slot, anchor)
                            : undefined
                        }
                        onScheduleTemplate={
                          role === "user" && !template
                            ? () => openTemplateSchedule(slot, anchor)
                            : undefined
                        }
                        scheduleAvailable={
                          !template && schedulesQuery.data?.available === true
                        }
                        scheduleFromAnchor={
                          Boolean(anchor) &&
                          renderNodes.some(
                            (node) => node.id === anchor && node.role === "user"
                          )
                        }
                        onCancel={() => closeTreeDraft(anchor)}
                        onFiles={(files) => void uploadFiles(slot, files)}
                        onRemoveAttachment={(part) =>
                          removeAttachment(slot, part)
                        }
                        onPreview={(src, name) => setViewer({ src, name })}
                        onOpenResources={() => {
                          setPickerSlot(slot)
                          setResourcePickerOpen(true)
                        }}
                        onOpenPrompts={() => {
                          setPickerSlot(slot)
                          setPromptPickerOpen(true)
                        }}
                        onStop={() =>
                          streamsForActiveChat.forEach(([id]) => stopStream(id))
                        }
                        onRevealContextMessage={setScrollTargetId}
                      />
                    </div>
                  )
                }}
                onOpenDraft={openTreeDraft}
                onChanged={invalidateWorkspace}
                onGenerateReplies={streamTreeRepliesFromNode}
                onAnswerTools={streamTreeResume}
                editor={messageEditor}
                onStop={() =>
                  streamsForActiveChat.forEach(([id]) => stopStream(id))
                }
                initialCamera={renderedViewState.camera}
                onCameraChange={(camera) => {
                  if (data.chat) persistTreeCamera(data.chat.id, camera)
                }}
              />
            )}
            <AnimatePresence>
              {find.findOpen ? (
                <ConversationFindBar
                  view={view}
                  query={find.findQuery}
                  onQueryChange={find.onQueryChange}
                  focusNonce={find.focusNonce}
                  current={find.current}
                  total={find.total}
                  onPrev={() => find.stepFind(-1)}
                  onNext={() => find.stepFind(1)}
                  onClose={find.closeFind}
                  pathCount={find.pathCount}
                  offPathCount={find.offPathCount}
                  onShowInTree={find.showOffPathInTree}
                  onJump={find.jumpToFirstOffPath}
                  showUseThisPath={find.showUseThisPath}
                  onUseThisPath={find.useThisPath}
                  results={find.results}
                  activeNodeId={find.activeNodeId}
                  onSelectResult={find.locateNode}
                  animate={animate}
                  transition={transition}
                />
              ) : null}
            </AnimatePresence>
          </MessageLayer>
        </ScheduledGenerationProvider>

        {view === "linear" ? (
          <div className="shrink-0 border-t border-border bg-background p-3 sm:px-6 sm:py-4">
            <div
              className="mx-auto"
              style={{ maxWidth: "var(--composer-width, 48rem)" }}
            >
              <SessionMessageEditor
                slot={linearComposerSlot}
                animate={animate && transition.duration > 0}
                placeholder="Message Nibchat…"
                mcpAvailable={mcpAvailableForGeneration}
                allowAttachments
                streaming={streamsForActiveChat.length > 0}
                showContextPreview
                contextParentId={composerParentId}
                sendLabel="Send"
                onSend={() => void streamSubmit()}
                onSendMultiple={(count) => void streamSubmit(count)}
                onSchedule={
                  template
                    ? undefined
                    : () =>
                        openScheduleComposer(
                          linearComposerSlot,
                          composerParentId
                        )
                }
                onScheduleTemplate={
                  template
                    ? undefined
                    : () =>
                        openTemplateSchedule(
                          linearComposerSlot,
                          composerParentId
                        )
                }
                scheduleAvailable={
                  !template && schedulesQuery.data?.available === true
                }
                scheduleFromAnchor={leafIsUser}
                onFiles={(files) => void uploadFiles(linearComposerSlot, files)}
                onRemoveAttachment={(part) =>
                  removeAttachment(linearComposerSlot, part)
                }
                onPreview={(src, name) => setViewer({ src, name })}
                onOpenResources={() => {
                  setPickerSlot(linearComposerSlot)
                  setResourcePickerOpen(true)
                }}
                onOpenPrompts={() => {
                  setPickerSlot(linearComposerSlot)
                  setPromptPickerOpen(true)
                }}
                onStop={() =>
                  streamsForActiveChat.forEach(([id]) => stopStream(id))
                }
                onRevealContextMessage={setScrollTargetId}
              />
            </div>
          </div>
        ) : null}

        <AlertDialog
          open={scheduleToCancel != null}
          onOpenChange={(open) => {
            if (!open) setScheduleToCancel(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel scheduled generation?</AlertDialogTitle>
              <AlertDialogDescription>
                This pending reply will not run. The message stays.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={cancelScheduleMutation.isPending}
                onClick={() => {
                  if (!scheduleToCancel) return
                  cancelScheduleMutation.mutate({ id: scheduleToCancel })
                  setScheduleToCancel(null)
                }}
              >
                Cancel schedule
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <ScheduledGenerationDialog
          schedule={editingSchedule}
          onOpenChange={(open) => {
            if (!open) setEditingScheduleId(null)
          }}
        />
        <Dialog open={scheduleSendOpen} onOpenChange={setScheduleSendOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Generate later</DialogTitle>
              <DialogDescription>
                {scheduleSource?.draft.text.trim() ||
                scheduleSource?.draft.attachments.length
                  ? "Save this message now and run the reply at the chosen time."
                  : "Run the reply from this message at the chosen time."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              {schedulePreview ? (
                <p className="line-clamp-3 rounded-xl bg-muted p-3 text-sm whitespace-pre-wrap">
                  {schedulePreview}
                </p>
              ) : null}
              {scheduleSource?.draft.attachments.length ? (
                <p className="text-xs text-muted-foreground">
                  {attachmentCountLabel(
                    scheduleSource.draft.attachments.length
                  )}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const date = new Date(Date.now() + 60 * 60 * 1000)
                    setScheduleSendClock({
                      ...defaultScheduleClock(),
                      kind: "once",
                      date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
                      time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
                    })
                  }}
                >
                  In 1 hour
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setScheduleSendClock({
                      ...defaultScheduleClock(),
                      kind: "once",
                    })
                  }
                >
                  Tomorrow morning
                </Button>
              </div>
              <ScheduleClockFields
                clock={scheduleSendClock}
                spaces={workspace.spaces}
                onceOnly
                showSpace={false}
                onChange={(patch) =>
                  setScheduleSendClock((current) => ({
                    ...current,
                    ...patch,
                    kind: "once",
                  }))
                }
              />
              <GenerationCountField
                id="chat-schedule-replies"
                value={scheduleSendReplyCount}
                onChange={setScheduleSendReplyCount}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setScheduleSendOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={
                  createMessageMutation.isPending ||
                  createChatScheduleMutation.isPending ||
                  Boolean(scheduleClockError(scheduleSendClock)) ||
                  !generationCountInRange(scheduleSendReplyCount)
                }
                onClick={() => void scheduleComposer()}
              >
                Schedule generation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={templateScheduleOpen}
          onOpenChange={setTemplateScheduleOpen}
        >
          <DialogContent className="max-h-[min(40rem,calc(100%-2rem))] max-w-md overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Schedule as template</DialogTitle>
              <DialogDescription>
                {templateScheduleSource?.chatId
                  ? "Save this message in the current chat and create a template from it."
                  : "Create a template from this draft without opening a chat."}{" "}
                Each run starts a new chat and replies there.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="template-schedule-name">Template name</Label>
                <Input
                  id="template-schedule-name"
                  value={templateScheduleName}
                  maxLength={MAX_NAME}
                  onChange={(event) =>
                    setTemplateScheduleName(event.target.value)
                  }
                />
              </div>
              <ScheduleClockFields
                clock={templateScheduleClock}
                spaces={workspace.spaces}
                onChange={(patch) =>
                  setTemplateScheduleClock((current) => ({
                    ...current,
                    ...patch,
                  }))
                }
              />
              <GenerationCountField
                id="template-schedule-replies"
                value={templateScheduleReplyCount}
                onChange={setTemplateScheduleReplyCount}
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setTemplateScheduleOpen(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={
                  !templateScheduleName.trim() ||
                  sendAndScheduleTemplateMutation.isPending ||
                  inFlightCount > 0 ||
                  Boolean(scheduleClockError(templateScheduleClock)) ||
                  !generationCountInRange(templateScheduleReplyCount)
                }
                onClick={() => void submitTemplateSchedule()}
              >
                Create schedule
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ImageViewer image={viewer} onClose={() => setViewer(null)} />

        <Dialog open={resourcePickerOpen} onOpenChange={setResourcePickerOpen}>
          <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Attach MCP resource</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {surfacesQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : null}
              {surfacesQuery.data?.every((s) => s.resources.length === 0) ? (
                <p className="text-sm text-muted-foreground">
                  No resources in approved MCP catalogs. Refresh and approve a
                  server that exposes resources.
                </p>
              ) : null}
              {surfacesQuery.data?.map((surface) =>
                surface.resources.length === 0 ? null : (
                  <div key={surface.profileId} className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {surface.profileName}
                    </p>
                    {surface.resources.map((resource) => (
                      <Button
                        key={resource.uri}
                        type="button"
                        variant="outline"
                        className="h-auto w-full justify-start px-3 py-2 text-left"
                        onClick={() => {
                          const current = readComposerDraft(pickerSlot)
                          if (
                            current.attachments.some(
                              (item) =>
                                item.reference.kind === "mcp-resource" &&
                                item.reference.profileId ===
                                  surface.profileId &&
                                item.reference.uri === resource.uri
                            )
                          ) {
                            setResourcePickerOpen(false)
                            return
                          }
                          const next = [
                            ...current.attachments,
                            {
                              name: resource.name,
                              reference: {
                                kind: "mcp-resource" as const,
                                profileId: surface.profileId,
                                uri: resource.uri,
                                resolution: { kind: "live" as const },
                              },
                            },
                          ]
                          updateSessionDraft(pickerSlot, { attachments: next })
                          setResourcePickerOpen(false)
                          toast.success(`Attached ${resource.name}`)
                        }}
                      >
                        <span className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">
                            {resource.name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {resource.uri}
                          </span>
                        </span>
                      </Button>
                    ))}
                  </div>
                )
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={promptPickerOpen} onOpenChange={setPromptPickerOpen}>
          <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Insert MCP prompt</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {surfacesQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : null}
              {surfacesQuery.data?.every((s) => s.prompts.length === 0) ? (
                <p className="text-sm text-muted-foreground">
                  No prompts in approved MCP catalogs.
                </p>
              ) : null}
              {surfacesQuery.data?.map((surface) =>
                surface.prompts.length === 0 ? null : (
                  <div key={surface.profileId} className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {surface.profileName}
                    </p>
                    {surface.prompts.map((prompt) => (
                      <Button
                        key={prompt.name}
                        type="button"
                        variant="outline"
                        className="h-auto w-full justify-start px-3 py-2 text-left"
                        disabled={getPromptMut.isPending}
                        onClick={async () => {
                          try {
                            const result = await getPromptMut.mutateAsync({
                              profileId: surface.profileId,
                              name: prompt.name,
                            })
                            const current = readComposerDraft(pickerSlot)
                            const next = current.text.trim()
                              ? `${current.text.trim()}\n\n${result.text}`
                              : result.text
                            updateSessionDraft(pickerSlot, { text: next })
                            setPromptPickerOpen(false)
                            toast.success("Prompt inserted into composer")
                          } catch {
                            /* toast in mutation */
                          }
                        }}
                      >
                        <span className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">
                            {prompt.title || prompt.name}
                          </span>
                          {prompt.description ? (
                            <span className="text-xs text-muted-foreground">
                              {prompt.description}
                            </span>
                          ) : null}
                        </span>
                      </Button>
                    ))}
                  </div>
                )
              )}
            </div>
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={find.pendingPathNodeId !== null}
          onOpenChange={(open) => {
            if (!open) find.dismissPathSwitch()
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Switch branch?</AlertDialogTitle>
              <AlertDialogDescription>
                Jumping to this message changes the selected path. That updates
                the conversation root and the selected child of each ancestor so
                Linear can show this branch. This is not undoable from Find.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={find.pathSwitchPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={find.pathSwitchPending}
                onClick={find.confirmPathSwitch}
              >
                Switch path
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {template ? "Rename template" : "Rename conversation"}
              </DialogTitle>
            </DialogHeader>
            <Input
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void submitRename()
                }
              }}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRenameOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void submitRename()}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={saveTemplateOpen} onOpenChange={setSaveTemplateOpen}>
          <DialogContent className="max-h-[min(40rem,calc(100%-2rem))] max-w-md overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Save chat template</DialogTitle>
              <DialogDescription>
                Saves this conversation&apos;s complete message tree, including
                branches. New chats can start from it, and a space can use it as
                the default. The template does not save chat settings.
                {scheduleEnabled && canSchedule
                  ? " This schedule keeps this chat’s own settings. Each run also uses your current user and selected space defaults."
                  : null}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="save-template-name">Name</Label>
                <Input
                  id="save-template-name"
                  value={saveTemplateName}
                  maxLength={MAX_NAME}
                  onChange={(event) => setSaveTemplateName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return
                    event.preventDefault()
                    submitSaveTemplate()
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="save-template-replace">Save as</Label>
                <Select
                  value={replaceTemplateId}
                  items={{
                    [SAVE_TEMPLATE_NEW]: "New template",
                    ...Object.fromEntries(
                      (templatesQuery.data ?? []).map((template) => [
                        template.id,
                        `Replace ${template.name}`,
                      ])
                    ),
                  }}
                  onValueChange={(value) => {
                    if (value == null) return
                    const id = String(value)
                    setReplaceTemplateId(id)
                    const selected = templatesQuery.data?.find(
                      (template) => template.id === id
                    )
                    if (selected) setSaveTemplateName(selected.name)
                  }}
                >
                  <SelectTrigger id="save-template-replace" className="w-full">
                    <SelectValue placeholder="New template" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SAVE_TEMPLATE_NEW}>
                      New template
                    </SelectItem>
                    {(templatesQuery.data ?? []).map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        Replace {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {replaceTemplateId !== SAVE_TEMPLATE_NEW ? (
                <p className="text-xs text-muted-foreground">
                  {scheduleEnabled && canSchedule
                    ? "This overwrites the saved tree. Schedules that already use it take this clock. Existing chats stay as they are."
                    : "This overwrites the saved tree. Existing chats stay as they are."}
                </p>
              ) : null}
              <div className="flex items-start justify-between gap-3">
                <div className="grid gap-0.5">
                  <Label htmlFor="save-template-schedule">
                    Run on a schedule
                  </Label>
                  {!leafIsUser ? (
                    <p className="text-xs text-muted-foreground">
                      A schedule continues from your last message. Send one, or
                      select a branch that ends on one.
                    </p>
                  ) : inFlightCount > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Wait for replies to finish before scheduling this chat.
                    </p>
                  ) : schedulesQuery.isSuccess &&
                    !schedulesQuery.data.available ? (
                    <p className="text-xs text-muted-foreground">
                      This server is in stateless generation mode, so schedules
                      stay stored and do not run.
                    </p>
                  ) : null}
                </div>
                <Switch
                  id="save-template-schedule"
                  checked={canSchedule && scheduleEnabled}
                  disabled={!canSchedule}
                  onCheckedChange={(checked) => setScheduleEnabled(checked)}
                />
              </div>
              {canSchedule && scheduleEnabled ? (
                <div className="grid gap-3">
                  <ScheduleClockFields
                    clock={scheduleClock}
                    spaces={data.spaces ?? []}
                    onChange={(patch) =>
                      setScheduleClock((current) => ({ ...current, ...patch }))
                    }
                  />
                  <GenerationCountField
                    id="save-template-replies"
                    value={scheduleReplyCount}
                    onChange={setScheduleReplyCount}
                  />
                </div>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setSaveTemplateOpen(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={
                  !data.chat ||
                  !saveTemplateName.trim() ||
                  saveTemplateMutation.isPending ||
                  scheduleFromChatMutation.isPending ||
                  inFlightCount > 0 ||
                  (scheduleEnabled &&
                    canSchedule &&
                    Boolean(scheduleClockError(scheduleClock))) ||
                  (scheduleEnabled &&
                    canSchedule &&
                    !generationCountInRange(scheduleReplyCount))
                }
                onClick={submitSaveTemplate}
              >
                {replaceTemplateId === SAVE_TEMPLATE_NEW ? "Save" : "Replace"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <AlertDialog
          open={pendingTemplateId !== undefined}
          onOpenChange={(open) => {
            if (!open) setPendingTemplateId(undefined)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Switch templates?</AlertDialogTitle>
              <AlertDialogDescription>
                Unfinished message edits in this draft will be discarded.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep editing</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (pendingTemplateId === undefined) return
                  selectDraftTemplate(pendingTemplateId)
                  setPendingTemplateId(undefined)
                }}
              >
                Switch template
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </ContextPreviewProvider>
  )
}

function ComposerRoleToggle({
  value,
  onChange,
  className,
}: {
  value: "user" | "assistant"
  onChange: (role: "user" | "assistant") => void
  className?: string
}) {
  return (
    <div className={cn("flex gap-1", className)}>
      {(["user", "assistant"] as const).map((role) => (
        <Button
          key={role}
          type="button"
          size="xs"
          variant={value === role ? "secondary" : "ghost"}
          onClick={() => onChange(role)}
        >
          {role === "user" ? "User" : "Assistant"}
        </Button>
      ))}
    </div>
  )
}
