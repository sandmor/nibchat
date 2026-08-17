"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { LayoutTable01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { parseJson, resolveActivePath } from "@/lib/domain"
import { chatStreamEntries, useStreamStore } from "@/lib/stream-store"
import { useTRPC } from "@/lib/trpc-react"
import {
  patchChatTitle,
  patchSelection,
  workspaceInput,
  type WorkspaceData,
} from "@/lib/workspace-cache"
import { motionTransition, shouldAnimate } from "@/lib/appearance"
import type { ModelConfigLocal } from "./types"
import { seedDraftModelConfig, usePrefersReducedMotion } from "./hooks"
import { ModelPicker } from "./model-picker"
import { GenerationParameters } from "./generation-parameters"
import { PromptStackPicker } from "./prompt-stack-picker"
import { ChatTranscript } from "./chat-transcript"
import { ChatTree } from "./chat-tree"
import { composeLayoutAnchor, composeLayoutId } from "./tree-layout"
import { SessionComposer } from "./conversation-composer"
import {
  composerSlotId,
  hasComposerDraft,
  readComposerDraft,
  shouldDeleteUploadedAttachment,
  treeDraftAnchorsForChat,
  type ComposerAttachment,
  useConversationSessionStore,
  useTreeDraftSlotSignature,
} from "./conversation-session-store"
import { ImageViewer } from "./image-viewer"
import { chatRouteIdentity } from "./chat-transcript-helpers"
import { useWorkspaceChrome } from "./shell"
import { DocumentTitle } from "@/components/document-title"
import { MAX_IMAGE_ATTACHMENTS, type NodeRow } from "@/lib/types"
import {
  readStreamEvents,
  shouldSoftFollow,
  streamPlacement,
  viewPathFromCache,
  type StreamRequestBody,
} from "./stream-helpers"

type Props = {
  mode: "draft" | "chat"
  chatId: string | null
  initial: WorkspaceData
  /** When set, select this node into the active path on mount. */
  selectNodeId?: string | null
}

export function ChatView({ mode, chatId, initial, selectNodeId }: Props) {
  const { appearance, providers: chromeProviders } = useWorkspaceChrome()
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useRouter()
  /** URL-derived selection: null when drafting, string when on /chat/[id] */
  const selectedChatId = mode === "draft" ? null : chatId
  const linearComposerSlot = composerSlotId(selectedChatId, "linear", null)
  const updateSessionDraft = useConversationSessionStore(
    (state) => state.update
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
  /** Deliberately route-local: every chat opens in the familiar linear view. */
  const [view, setView] = useState<"linear" | "tree">("linear")
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
          if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
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
        if (!aliveRef.current && bound)
          disposeSessionChat(bound === "draft" ? null : bound)
      }, 0)
    }
  }, [disposeSessionChat])

  // Soft-nav between /chat/[id] reuses this component instance. Drop scroll
  // targets and re-enable deep links for the chat now on screen.
  const chatIdentity = chatRouteIdentity(selectedChatId)
  useEffect(() => {
    if (boundChatIdentityRef.current === chatIdentity) return
    const previous = boundChatIdentityRef.current
    boundChatIdentityRef.current = chatIdentity
    setScrollTargetId(null)
    if (previous) {
      const previousChatId = previous === "draft" ? null : previous
      disposeSessionChat(previousChatId)
    }
    setView("linear")
    setPickerSlot(composerSlotId(selectedChatId, "linear", null))
    setComposeMorphs({})
    nodeDeepLinkDone.current = false
  }, [chatIdentity, disposeSessionChat, selectedChatId])

  const prefersReduced = usePrefersReducedMotion()
  const animate = shouldAnimate(appearance.motion, prefersReduced)
  const transition = motionTransition(appearance.motion)

  const startStream = useStreamStore((state) => state.start)
  const appendText = useStreamStore((state) => state.appendText)
  const appendReasoning = useStreamStore((state) => state.appendReasoning)
  const upsertTool = useStreamStore((state) => state.upsertTool)
  const attachController = useStreamStore((state) => state.attachController)
  const stopStream = useStreamStore((state) => state.stop)
  const finishStream = useStreamStore((state) => state.finish)
  /** Placement only. Token text lives in buffers; StreamingBubble reads those. */
  const streamMetas = useStreamStore((state) => state.streams)

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

  const data: WorkspaceData = workspaceQuery.data ?? initial
  const providers = providersQuery.data ?? chromeProviders
  const knownChats = data.chats

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

  function ensureModelReady(config: ModelConfigLocal) {
    if (!config.providerId || !config.model) {
      toast.error("Choose a provider and model before sending a message.")
      return false
    }
    return true
  }

  async function runStream(
    body: StreamRequestBody,
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
      }) => void
      /** Tree actions must not rewrite the persisted linear-path selection. */
      suppressSelectionFollow?: boolean
    }
  ) {
    const modelConfig = options?.modelConfig ?? activeModelConfig
    if (!ensureModelReady(modelConfig)) return false
    let streamId: string | undefined
    if (aliveRef.current) setInFlightCount((n) => n + 1)
    let failed = false
    try {
      const controller = new AbortController()
      streamId = crypto.randomUUID()
      attachController(streamId, controller)
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
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
      const parentHeader = response.headers.get("X-Nibchat-Parent-Node")
      const userNodeId = response.headers.get("X-Nibchat-User-Node")
      // Prefer structural parent from the server; fall back to request body.
      const parentNodeId =
        parentHeader ??
        (body.intent === "continue"
          ? userNodeId
          : body.intent === "generate"
            ? body.parentNodeId
            : body.intent === "resume" || body.intent === "regenerate"
              ? null
              : null)
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
      const streamRead = response.body
        ? readStreamEvents(response.body, {
            onText: (delta) => appendText(streamId!, delta),
            onReasoning: (delta) => appendReasoning(streamId!, delta),
            onTool: (tool) => upsertTool(streamId!, tool),
          })
        : Promise.resolve()

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
        options?.onWorkspaceReady?.({
          userNodeId,
          assistantNodeId: nodeId,
        })
      }

      await Promise.all([streamRead, reconcileWorkspace()])
      await queryClient.invalidateQueries({
        queryKey: trpc.workspace.get.queryKey({ chatId: body.chatId }),
      })
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        failed = true
        if (aliveRef.current) {
          toast.error(error instanceof Error ? error.message : "Stream failed")
        }
        await queryClient.invalidateQueries({
          queryKey: trpc.workspace.get.queryKey({ chatId: body.chatId }),
        })
      }
    } finally {
      if (aliveRef.current) setInFlightCount((n) => Math.max(0, n - 1))
      if (streamId) finishStream(streamId)
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
          }
          queryClient.setQueryData(
            trpc.workspace.get.queryKey({ chatId: chat.id }),
            payload
          )
          queryClient.setQueryData(
            trpc.workspace.get.queryKey({ draft: true }),
            { chats: payload.chats, chat: null, nodes: [] }
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

  async function uploadImages(slot: string, files: FileList | File[]) {
    const read = () => readComposerDraft(slot)
    const writeAttachments = (next: ComposerAttachment[]) => {
      updateSessionDraft(slot, { attachments: next })
    }
    const all = Array.from(files)
    const selected = all.filter(
      (file) =>
        file.type.startsWith("image/") ||
        file.type === "" ||
        file.type === "application/octet-stream"
    )
    if (selected.length !== all.length)
      toast.error("Only image files can be attached")
    if (!selected.length) return
    const imageCount = read().attachments.filter(
      (item) => item.reference.kind === "uploaded-file"
    ).length
    if (imageCount + selected.length > MAX_IMAGE_ATTACHMENTS) {
      toast.error("You can attach up to four images")
      return
    }
    const placeholders: ComposerAttachment[] = selected.map((file) => ({
      name: file.name,
      previewUrl: URL.createObjectURL(file),
      uploading: true,
      reference: { kind: "uploaded-file", id: crypto.randomUUID() },
    }))
    writeAttachments([...read().attachments, ...placeholders])
    for (const [index, file] of selected.entries()) {
      const part = placeholders[index]!
      const localId =
        part.reference.kind === "uploaded-file" ? part.reference.id : ""
      const previewUrl = part.previewUrl!
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
          error?: string
        }
        if (!response.ok || !payload.id)
          throw new Error(payload.error || "Image upload failed")
        if (!aliveRef.current || cancelledUploadIds.current.has(localId)) {
          void fetch(`/api/attachments/${payload.id}`, { method: "DELETE" })
          URL.revokeObjectURL(previewUrl)
          continue
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
          URL.revokeObjectURL(previewUrl)
          if (viewer?.src === previewUrl) setViewer(null)
          toast.error(
            error instanceof Error ? error.message : "Image upload failed"
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
    if (part.previewUrl) URL.revokeObjectURL(part.previewUrl)
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

  async function streamGenerate(parentNodeId: string) {
    if (!data.chat) return
    await runStream({
      chatId: data.chat.id,
      intent: "generate",
      parentNodeId,
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
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
      if (mode === "sent") continue
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

  async function streamTreeGenerate(parentNodeId: string) {
    if (!data.chat) return
    await runStream(
      { chatId: data.chat.id, intent: "generate", parentNodeId },
      { suppressSelectionFollow: true }
    )
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

  return (
    <section
      data-theme-group="chat"
      data-theme-target="chat"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-chat"
    >
      <DocumentTitle title={data.chat?.title ?? "New conversation"} />
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
              setRenameTitle(data.chat.title)
              setRenameOpen(true)
            }}
            className={cn("truncate font-medium", data.chat && "cursor-text")}
            title={data.chat ? "Double-click to rename" : undefined}
          >
            {data.chat?.title ?? "New conversation"}
          </h1>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">
            Each reply can become its own direction.
          </p>
        </div>
        <div className="flex min-w-0 items-center gap-0.5 sm:max-w-[min(36rem,70%)] sm:shrink-0 sm:gap-1">
          <Button
            type="button"
            variant={view === "tree" ? "secondary" : "ghost"}
            size="sm"
            className="gap-1.5"
            aria-pressed={view === "tree"}
            disabled={!data.chat}
            onClick={() =>
              setView((current) => (current === "tree" ? "linear" : "tree"))
            }
          >
            <HugeiconsIcon
              icon={LayoutTable01Icon}
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
          scrollTargetId={scrollTargetId}
          onScrollTargetConsumed={consumeScrollTarget}
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
          onGenerateUnder={streamGenerate}
          onAnswerTools={streamResume}
        />
      ) : (
        <ChatTree
          key={chatIdentity}
          nodes={data.nodes}
          activePath={activePath}
          draftAnchors={treeDraftAnchors}
          providers={providers}
          streamIdByNodeId={streamIdByNodeId}
          animate={animate}
          transition={transition}
          messageActionCaptions={appearance.messageActions.captions}
          messageLayoutIds={composeMorphs}
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
                onSend={options.onSend}
                onCancel={() => closeTreeDraft(anchor)}
                onFiles={(files) => void uploadImages(slot, files)}
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
              />
            )
          }}
          onOpenDraft={openTreeDraft}
          onChanged={invalidateWorkspace}
          onRegenerate={streamTreeRegenerate}
          onGenerateUnder={streamTreeGenerate}
          onAnswerTools={streamTreeResume}
          onStop={() => streamsForActiveChat.forEach(([id]) => stopStream(id))}
        />
      )}

      {view === "linear" ? (
        <div className="border-t border-border bg-background p-3 sm:px-6 sm:py-4">
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
              onSend={() => void streamContinue()}
              onFiles={(files) => void uploadImages(linearComposerSlot, files)}
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
                              item.reference.profileId === surface.profileId &&
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
  )
}
