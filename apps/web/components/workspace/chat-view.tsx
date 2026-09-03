"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"
import { useShallow } from "zustand/react/shallow"
import { AnimatePresence } from "motion/react"
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
import { cn } from "@/lib/utils"
import { parseJson, resolveActivePath } from "@/lib/domain"
import { displayChatTitle } from "@/lib/chat-title"
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
import { seedDraftModelConfig, usePrefersReducedMotion } from "./hooks"
import { ModelPicker } from "./model-picker"
import { GenerationParameters } from "./generation-parameters"
import { PromptStackPicker } from "./prompt-stack-picker"
import { ChatTranscript } from "./chat-transcript"
import { ChatTree } from "./chat-tree"
import { drainChatViewStateSaves } from "./chat-view-state-persistence"
import { composeLayoutAnchor, composeLayoutId } from "./tree-layout"
import { ConversationFindLayer } from "./conversation-find"
import { ConversationFindBar } from "./conversation-find-bar"
import { useConversationFindSession } from "./conversation-find-session"
import { SessionComposer } from "./conversation-composer"
import { type MessageComposerBindings } from "./message"
import { ContextPreviewProvider } from "./context-preview"
import {
  composerSlotId,
  hasComposerDraft,
  isComposerSending,
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
} from "@/lib/types"
import { analyzePdf } from "@/lib/pdf-analysis-client"
import type { PdfAnalysis } from "@/lib/pdf-analysis"
import {
  applyStoppingStreamPatches,
  followGenerationStream,
  planStreamEnd,
  readStreamEvents,
  shouldFollowGeneration,
  shouldSoftFollow,
  streamPlacement,
  viewPathFromCache,
  type StreamEndReason,
  type StreamRequestInput,
  type StreamRequestBody,
} from "./stream-helpers"
import type { GenerationTerminalPayload } from "@/lib/generation-streams/events"
import { prepareStaticMarkdown } from "@/lib/static-markdown"
import { normalizeLatexDelimiters } from "@/lib/normalize-latex-delimiters"
import { coalesceAdjacentTextParts } from "@/lib/agent/parts"

type Props = {
  mode: "draft" | "chat"
  chatId: string | null
  initial: WorkspaceData
  /** When set, select this node into the active path on mount. */
  selectNodeId?: string | null
}

function isPdfFile(file: File) {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  )
}

function readChatViewState(raw: string | undefined): ChatViewState {
  return raw ? parseChatViewState(raw) : DEFAULT_CHAT_VIEW_STATE
}

export function ChatView({ mode, chatId, initial, selectNodeId }: Props) {
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
  const restoreLinearDraft = (text: string, pending: ComposerAttachment[]) => {
    const current = readComposerDraft(linearComposerSlot)
    updateSessionDraft(linearComposerSlot, {
      text: current.text || text,
      attachments: current.attachments.length ? current.attachments : pending,
    })
  }
  const [viewer, setViewer] = useState<{ src: string; name: string } | null>(
    null
  )
  const [resourcePickerOpen, setResourcePickerOpen] = useState(false)
  const [promptPickerOpen, setPromptPickerOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameTitle, setRenameTitle] = useState("")
  const [draftModelConfig, setDraftModelConfig] = useState<ModelConfigLocal>(
    () => seedDraftModelConfig(initial.chats, chromeProviders)
  )
  const [draftPromptStackId, setDraftPromptStackId] = useState<string | null>(
    null
  )
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
      const drafts = useConversationSessionStore.getState().drafts
      for (const [slot, draft] of Object.entries(drafts)) {
        if (!slot.startsWith(prefix)) continue
        for (const attachment of draft.attachments) {
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
  /** Placement only. Token text lives in buffers; StreamingBubble reads those. */
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

  const workspaceKeyInput = workspaceInput(selectedChatId)
  const workspaceQuery = useQuery({
    ...trpc.workspace.get.queryOptions(workspaceKeyInput),
    initialData: initial,
  })

  // Shell already loaded providers; re-query stays warm without a page parallel fetch.
  const providersQuery = useQuery({
    ...trpc.workspace.listProviders.queryOptions(),
    initialData: chromeProviders,
  })

  const workspace = workspaceQuery.data ?? initial
  const data: WorkspaceData = useMemo(
    () =>
      applyStoppingStreamPatches(workspace, streamMetas, stoppingBuffers) ??
      workspace,
    [stoppingBuffers, streamMetas, workspace]
  )
  const providers = providersQuery.data ?? chromeProviders
  const knownChats = data.chats

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

  const activeModelConfig: ModelConfigLocal = data.chat
    ? parseJson<ModelConfigLocal>(data.chat.model_config_json, {})
    : draftModelConfig

  const invalidateWorkspace = async () => {
    await queryClient.invalidateQueries(trpc.workspace.get.queryFilter())
  }

  const createChatMutation = useMutation(
    trpc.workspace.createChat.mutationOptions()
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

  const activePath = useMemo(
    () =>
      data.chat
        ? resolveActivePath(data.nodes, data.chat.selected_root_node_id)
        : [],
    [data]
  )
  const pathIds = useMemo(() => activePath.map((node) => node.id), [activePath])
  const find = useConversationFindSession({
    chatIdentity,
    view,
    setView: setPersistedView,
    nodes: data.nodes,
    pathIds,
    pathChatId: data.chat?.id ?? chatId,
    renameOpen,
    paneRef,
    selectPath: (input, options) => selectPathMutation.mutate(input, options),
    selectPathPending: selectPathMutation.isPending,
    setScrollTargetId,
  })

  function ensureModelReady(config: ModelConfigLocal) {
    if (!config.providerId || !config.model) {
      toast.error("Choose a provider and model before sending a message.")
      return false
    }
    return true
  }

  async function runStream(
    body: StreamRequestInput,
    options?: {
      modelConfig?: ModelConfigLocal
      /** Called after the stream is registered (response ok + startStream). */
      onStreamStarted?: (info: {
        userNodeId: string | null
        assistantNodeId: string
      }) => void
      /** After the first workspace refresh that includes the new rows. */
      onWorkspaceReady?: (info: {
        userNodeId: string | null
        assistantNodeId: string
      }) => void | Promise<void>
      /** Tree actions must not rewrite the persisted linear-path selection. */
      suppressSelectionFollow?: boolean
    }
  ) {
    const modelConfig = options?.modelConfig ?? activeModelConfig
    if (!ensureModelReady(modelConfig)) return false
    let streamId: string | undefined
    if (aliveRef.current) setInFlightCount((n) => n + 1)
    let failed = false
    let endReason: StreamEndReason = "gone"
    let terminalHandled = false
    const controller = new AbortController()
    try {
      streamId = crypto.randomUUID()
      const requestBody: StreamRequestBody = {
        ...body,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string
        }
        throw new Error(payload.error || `Stream failed (${response.status})`)
      }
      const nodeId =
        response.headers.get("X-Nibchat-Assistant-Node") ?? "pending"
      streamId = response.headers.get("X-Nibchat-Generation-Id") ?? streamId
      attachController(streamId, controller)
      const parentHeader = response.headers.get("X-Nibchat-Parent-Node")
      const userNodeId = response.headers.get("X-Nibchat-User-Node")
      // Prefer structural parent from the server; fall back to request body.
      const parentNodeId =
        parentHeader ?? (body.intent === "continue" ? userNodeId : null)
      startStream(streamId, {
        nodeId,
        chatId: body.chatId,
        parentNodeId,
      })
      options?.onStreamStarted?.({
        userNodeId,
        assistantNodeId: nodeId,
      })

      // Reading the response stream is an independent real-time boundary.
      // Start it before any query refetch or selection mutation so unrelated
      // cache latency can never delay first-token rendering.
      const liveStreamId = streamId
      const read = (body: ReadableStream<Uint8Array>) =>
        readStreamEvents(body, {
          onEvent: (event) => applyStreamEvent(liveStreamId, event),
          onCursor: (cursor) => setStreamCursor(liveStreamId, cursor),
        })
      const streamRead = (async () => {
        if (response.body) {
          try {
            const terminal = await read(response.body)
            if (terminal) return { type: "terminal", terminal } as const
          } catch {
            if (controller.signal.aborted) return "aborted" as const
          }
        }
        if (controller.signal.aborted) return "aborted" as const
        return followGenerationStream({
          streamId: liveStreamId,
          signal: controller.signal,
          cursor: useStreamStore.getState().cursors[liveStreamId] ?? null,
          onEvent: (event) => applyStreamEvent(liveStreamId, event),
          onCursor: (cursor) => setStreamCursor(liveStreamId, cursor),
        })
      })()

      const reconcileWorkspace = async () => {
        // Tree needs the durable user/assistant rows while SSE continues; all
        // surfaces benefit from the refresh, but none wait on it to read tokens.
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
          nodeId !== "pending" &&
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
            nodeId,
          })
        }
        await queryClient.invalidateQueries({
          queryKey: trpc.workspace.get.queryKey({ draft: true }),
        })
        await options?.onWorkspaceReady?.({
          userNodeId,
          assistantNodeId: nodeId,
        })
      }

      const reconcile = reconcileWorkspace()
      const readerResult = await streamRead
      if (typeof readerResult === "object") {
        await applyTerminalHandoff(
          liveStreamId,
          readerResult.terminal,
          controller
        )
        terminalHandled = true
      } else endReason = readerResult === "aborted" ? "aborted" : "gone"
      await reconcile
    } catch (error) {
      const stopping = streamId
        ? Boolean(useStreamStore.getState().streams[streamId]?.stopping)
        : false
      if (controller.signal.aborted) {
        endReason = "aborted"
      } else {
        endReason = "failed"
        if (!stopping) {
          failed = true
          if (aliveRef.current) {
            toast.error(
              error instanceof Error ? error.message : "Stream failed"
            )
          }
          await queryClient.invalidateQueries({
            queryKey: trpc.workspace.get.queryKey({ chatId: body.chatId }),
          })
        }
      }
    } finally {
      if (aliveRef.current) setInFlightCount((n) => Math.max(0, n - 1))
      if (streamId && !terminalHandled)
        applyStreamEnd(streamId, endReason, controller)
    }
    return !failed
  }

  async function ensureChatId(
    modelConfig: ModelConfigLocal
  ): Promise<{ chatId: string; created: boolean }> {
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
      createChatLock.current = createChatMutation
        .mutateAsync({
          config: modelConfig,
          promptStackId: draftPromptStackId,
        })
        .then((chat) => {
          // Track the new id before replace so stream UI still matches on /chat/new.
          selectedChatIdRef.current = chat.id
          setPendingChatId(chat.id)
          const payload: WorkspaceData = {
            chats: [chat, ...knownChats.filter((c) => c.id !== chat.id)],
            chat,
            nodes: [],
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

  async function streamContinue() {
    const { text, attachments } = readComposerDraft(linearComposerSlot)
    const content = text.trim()
    if (!content && attachments.length === 0) return
    if (attachments.some((attachment) => attachment.uploading)) return
    if (!ensureModelReady(activeModelConfig)) return

    const contextLeafId = composerParentId
    const modelConfig = activeModelConfig
    const pendingAttachments = [...attachments]
    updateSessionDraft(linearComposerSlot, { text: "", attachments: [] })

    let ensuredId: string | null = null
    let created = false
    let replaced = false
    try {
      const ensured = await ensureChatId(modelConfig)
      ensuredId = ensured.chatId
      created = ensured.created
      // Start the stream before URL replace so remount sees Zustand state.
      const started = await runStream(
        {
          chatId: ensuredId,
          intent: "continue",
          parentNodeId: created ? null : contextLeafId,
          content,
          ...(pendingAttachments.length
            ? { attachments: pendingAttachments.map((item) => item.reference) }
            : {}),
        },
        {
          modelConfig,
          onStreamStarted: created
            ? () => {
                replaced = true
                router.replace(`/chat/${ensuredId}`)
              }
            : undefined,
        }
      )
      if (!started && aliveRef.current)
        restoreLinearDraft(content, pendingAttachments)
    } catch (error) {
      if (aliveRef.current) {
        restoreLinearDraft(content, pendingAttachments)
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not start conversation"
        )
      }
    } finally {
      // If create succeeded but stream never started, still leave draft URL.
      if (created && ensuredId && !replaced && aliveRef.current) {
        router.replace(`/chat/${ensuredId}`)
      }
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

  async function streamRegenerate(assistantNodeId: string) {
    if (!data.chat) return
    await runStream({
      chatId: data.chat.id,
      intent: "regenerate",
      assistantNodeId,
    })
  }

  function treeSlot(anchor: string | null) {
    return composerSlotId(data.chat?.id ?? selectedChatId, "tree", anchor)
  }

  function openTreeDraft(anchor: string | null) {
    if (!data.chat) return
    const slot = treeSlot(anchor)
    if (!hasComposerDraft(slot)) updateSessionDraft(slot, { text: "" })
  }

  function closeTreeDraft(
    anchor: string | null,
    mode: "discard" | "sent" = "discard"
  ) {
    if (!data.chat) return
    const slot = treeSlot(anchor)
    const draft = readComposerDraft(slot)
    for (const attachment of draft.attachments) {
      if (attachment.previewUrl) revokeComposerPreviewUrl(attachment.previewUrl)
      if (mode === "sent") continue
      removeAttachment(slot, attachment)
    }
    clearSessionDraft(slot)
  }

  function closeEditComposer(
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

  async function streamTreeSend(parentNodeId: string | null) {
    if (!data.chat || !ensureModelReady(activeModelConfig)) return false
    const slot = treeSlot(parentNodeId)
    const draft = readComposerDraft(slot)
    const content = draft.text.trim()
    if (!content && draft.attachments.length === 0) return false
    if (draft.attachments.some((attachment) => attachment.uploading))
      return false
    const treeChatId = data.chat.id
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
      void runStream(
        {
          chatId: treeChatId,
          intent: "continue",
          parentNodeId,
          content,
          ...(pendingAttachments.length
            ? {
                attachments: pendingAttachments.map((item) => item.reference),
              }
            : {}),
        },
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
    if (!data.chat || !ensureModelReady(activeModelConfig)) return false
    const slot = messageEditSlotId(node.chat_id, node.id)
    if (isComposerSending(slot)) return false
    const draft = readComposerDraft(slot)
    const content = draft.text.trim()
    if (!content && draft.attachments.length === 0) return false
    if (draft.attachments.some((attachment) => attachment.uploading))
      return false
    const chatId = data.chat.id
    const pendingAttachments = [...draft.attachments]
    setSessionSending(slot, true)
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
      void runStream(
        {
          chatId,
          intent: "continue",
          parentNodeId: node.parent_id,
          content,
          editedFromNodeId: node.id,
          ...(view === "linear" ? { attachSelection: true } : {}),
          ...(pendingAttachments.length
            ? {
                attachments: pendingAttachments.map((item) => item.reference),
              }
            : {}),
        },
        {
          suppressSelectionFollow: true,
          onStreamStarted: () => {
            started = true
          },
          onWorkspaceReady: () => {
            closeEditComposer(node, "sent")
            finish(true)
          },
        }
      ).then(() => {
        if (!started) {
          updateSessionDraft(slot, { attachments: pendingAttachments })
        }
        if (hasComposerDraft(slot)) setSessionSending(slot, false)
        finish(started)
      })
    })
  }

  async function streamTreeRegenerate(assistantNodeId: string) {
    if (!data.chat) return
    await runStream(
      { chatId: data.chat.id, intent: "regenerate", assistantNodeId },
      { suppressSelectionFollow: true }
    )
  }

  async function streamResume(
    assistantNodeId: string,
    toolResults: Array<{ toolCallId: string; output: unknown }>
  ) {
    if (!data.chat) return
    await runStream({
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
    await runStream(
      { chatId: data.chat.id, intent: "resume", assistantNodeId, toolResults },
      { suppressSelectionFollow: true }
    )
  }

  const setModelMutation = useMutation(
    trpc.workspace.setModel.mutationOptions({
      onSuccess: async () => {
        await invalidateWorkspace()
      },
      onError: (error) => toast.error(error.message || "Could not apply model"),
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
    setDraftModelConfig(next)
  }

  const streamsForActiveChat = chatStreamEntries(streamMetas, [
    selectedChatId,
    // On /chat/new after first create, selectedChatId is still null.
    pendingChatId,
    data.chat?.id,
  ])

  const pathVisibleStreams = streamsForActiveChat.filter(([, stream]) => {
    const place = streamPlacement(stream, activePath, data.nodes)
    return place === "inline" || place === "after-tip"
  })

  const streamIdByNodeId = new Map<string, string>()
  for (const [streamId, stream] of streamsForActiveChat) {
    streamIdByNodeId.set(stream.nodeId, streamId)
  }

  const afterTipStreams = streamsForActiveChat
    .filter(
      ([, stream]) =>
        streamPlacement(stream, activePath, data.nodes) === "after-tip"
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
    }),
    [
      activeModelConfig.providerId,
      activeModelConfig.model,
      activeModelConfig.replayReasoning,
    ]
  )
  const treeSlotSignature = useTreeDraftSlotSignature(data.chat?.id)
  const treeDraftAnchors = useMemo(() => {
    if (!data.chat) return new Set<string | null>()
    const anchors = treeDraftAnchorsForChat(
      useConversationSessionStore.getState().drafts,
      data.chat.id
    )
    // Hide the composer in the same render the user node appears, so layout
    // does not slide the open plus (composer) to the right of the new child.
    for (const [nodeId, layoutId] of Object.entries(composeMorphs)) {
      if (!data.nodes.some((node) => node.id === nodeId)) continue
      anchors.delete(composeLayoutAnchor(layoutId))
    }
    return anchors
  }, [data.chat, data.nodes, treeSlotSignature, composeMorphs])
  const editSlotSignature = useMessageEditSlotSignature(data.chat?.id)
  const editingNodeIds = useMemo(() => {
    if (!data.chat || !editSlotSignature) return new Set<string>()
    return messageEditNodeIdsForChat(
      useConversationSessionStore.getState().edits,
      useConversationSessionStore.getState().drafts,
      data.chat.id
    )
  }, [data.chat, editSlotSignature])

  const messageComposer: MessageComposerBindings = {
    mcpAvailable: mcpAvailableForGeneration,
    animate: animate && transition.duration > 0,
    onSend: streamEditSend,
    onCancel: (node) => closeEditComposer(node),
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

  return (
    <ContextPreviewProvider
      nodes={data.nodes}
      chatStackId={data.chat?.prompt_stack_id ?? null}
      draftStackId={draftPromptStackId}
      hasChat={Boolean(data.chat)}
      modelConfig={previewModelConfig}
      providers={providers}
    >
      <section
        ref={paneRef}
        data-theme-group="chat"
        data-theme-target="chat"
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-chat"
      >
        <DocumentTitle title={displayChatTitle(data.chat?.title)} />
        <header
          className={cn(
            "flex shrink-0 flex-col gap-1.5 border-b sm:flex-row sm:items-center sm:gap-2",
            density === "compact"
              ? "px-3 py-2 sm:h-12 sm:py-0"
              : "px-3 py-2.5 sm:h-14 sm:px-5 sm:py-0"
          )}
        >
          <div className="min-w-0 flex-1">
            <h1
              onDoubleClick={() => {
                if (!data.chat) return
                setRenameTitle(data.chat.title ?? "")
                setRenameOpen(true)
              }}
              className={cn("truncate font-medium", data.chat && "cursor-text")}
              title={data.chat ? "Double-click to rename" : undefined}
            >
              {displayChatTitle(data.chat?.title)}
            </h1>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">
              Each reply can become its own direction.
            </p>
          </div>
          <div className="flex min-w-0 items-center gap-0.5 sm:max-w-[min(36rem,70%)] sm:shrink-0 sm:gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5"
              disabled={!data.chat}
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
              <span className="hidden sm:inline">
                {view === "tree" ? "Linear" : "Tree"}
              </span>
            </Button>
            <PromptStackPicker
              chatId={data.chat?.id}
              promptStackId={data.chat?.prompt_stack_id ?? null}
              draftStackId={draftPromptStackId}
              onDraftChange={setDraftPromptStackId}
              onChanged={invalidateWorkspace}
            />
            <ModelPicker
              config={activeModelConfig}
              chatId={data.chat?.id}
              providers={providers}
              showIds={appearance.modelPicker.showIds}
              onChange={(config) => void commitModelConfig(config)}
            />
            <GenerationParameters
              key={`${data.chat?.id ?? "draft"}:${activeModelConfig.providerId ?? ""}:${activeModelConfig.model ?? ""}`}
              config={activeModelConfig}
              chatId={data.chat?.id}
              onChange={(config) => void commitModelConfig(config)}
            />
          </div>
        </header>

        <ConversationFindLayer value={find.layerValue}>
          {view === "linear" ? (
            <ChatTranscript
              chatKey={chatKey}
              density={density}
              activePath={activePath}
              nodes={data.nodes}
              providers={providers}
              streamIdByNodeId={streamIdByNodeId}
              afterTipStreams={afterTipStreams}
              showEmpty={showEmpty}
              ariaBusy={ariaBusy}
              animate={animate}
              transition={transition}
              messageActionCaptions={appearance.messageActions.captions}
              editingNodeIds={editingNodeIds}
              scrollTargetId={scrollTargetId}
              onScrollTargetConsumed={consumeScrollTarget}
              findLocateKey={find.locateKey}
              onSelect={(parentId, childId) => {
                if (parentId)
                  selectChildMutation.mutate({
                    nodeId: parentId,
                    childId,
                  })
                else
                  selectRootMutation.mutate({
                    chatId: data.chat!.id,
                    nodeId: childId,
                  })
                // User-driven branch navigation — bring the selected tip into view.
                setScrollTargetId(childId)
              }}
              onChanged={() => invalidateWorkspace()}
              onRegenerate={streamRegenerate}
              onAnswerTools={streamResume}
              composer={messageComposer}
            />
          ) : (
            <ChatTree
              key={chatIdentity}
              nodes={data.nodes}
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
                return (
                  <SessionComposer
                    slot={slot}
                    variant="inline"
                    autoFocus={options.autoFocus}
                    submitting={options.submitting}
                    animate={animate && transition.duration > 0}
                    placeholder={
                      anchor
                        ? "Take this conversation somewhere new…"
                        : "Start a new root…"
                    }
                    mcpAvailable={mcpAvailableForGeneration}
                    streaming={options.submitting}
                    showContextPreview
                    contextParentId={anchor}
                    onSend={options.onSend}
                    onCancel={() => closeTreeDraft(anchor)}
                    onFiles={(files) => void uploadFiles(slot, files)}
                    onRemoveAttachment={(part) => removeAttachment(slot, part)}
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
                )
              }}
              onOpenDraft={openTreeDraft}
              onChanged={invalidateWorkspace}
              onRegenerate={streamTreeRegenerate}
              onAnswerTools={streamTreeResume}
              composer={messageComposer}
              onStop={() =>
                streamsForActiveChat.forEach(([id]) => stopStream(id))
              }
              initialCamera={renderedViewState.camera}
              onCameraChange={(camera) =>
                persistTreeCamera(data.chat!.id, camera)
              }
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
        </ConversationFindLayer>

        {view === "linear" ? (
          <div className="shrink-0 border-t border-border bg-background p-3 sm:px-6 sm:py-4">
            <div
              className="mx-auto"
              style={{ maxWidth: "var(--composer-width, 48rem)" }}
            >
              <SessionComposer
                slot={linearComposerSlot}
                animate={animate && transition.duration > 0}
                placeholder="Message Nibchat…"
                mcpAvailable={mcpAvailableForGeneration}
                streaming={streamsForActiveChat.length > 0}
                showContextPreview
                contextParentId={composerParentId}
                onSend={() => void streamContinue()}
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
              <DialogTitle>Rename conversation</DialogTitle>
            </DialogHeader>
            <Input
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void (async () => {
                    if (!data.chat || !renameTitle.trim()) return
                    await updateChatMutation.mutateAsync({
                      chatId: data.chat.id,
                      title: renameTitle.trim(),
                    })
                    setRenameOpen(false)
                  })()
                }
              }}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRenameOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (!data.chat || !renameTitle.trim()) return
                  await updateChatMutation.mutateAsync({
                    chatId: data.chat.id,
                    title: renameTitle.trim(),
                  })
                  setRenameOpen(false)
                }}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </ContextPreviewProvider>
  )
}
