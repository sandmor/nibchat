"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ImageAdd02Icon,
  Loading03Icon,
  SentIcon,
  StopIcon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { TooltipProvider, WithTooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { parseJson, resolveActivePath } from "@/lib/domain"
import { useStreamStore } from "@/lib/stream-store"
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
import { ImageViewer } from "./image-viewer"
import { chatRouteIdentity } from "./chat-transcript-helpers"
import { useWorkspaceChrome } from "./shell"
import { DocumentTitle } from "@/components/document-title"
import {
  MAX_IMAGE_ATTACHMENTS,
  type AttachmentReference,
  type NodeRow,
} from "@/lib/types"
import type { ActiveStream } from "@/lib/stream-store"
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

type ComposerAttachment = {
  name: string
  reference: AttachmentReference
  previewUrl?: string
  uploading?: boolean
}

export function ChatView({ mode, chatId, initial, selectNodeId }: Props) {
  const { appearance, providers: chromeProviders } = useWorkspaceChrome()
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useRouter()
  /** URL-derived selection: null when drafting, string when on /chat/[id] */
  const selectedChatId = mode === "draft" ? null : chatId
  const [composer, setComposer] = useState("")
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const attachmentsRef = useRef<ComposerAttachment[]>([])
  attachmentsRef.current = attachments
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [viewer, setViewer] = useState<{ src: string; name: string } | null>(
    null
  )
  const [dropActive, setDropActive] = useState(false)
  const dropDepthRef = useRef(0)
  const [mcpMenuOpen, setMcpMenuOpen] = useState(false)
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
  /** Removed uploads can finish after their chip is gone; delete their server row. */
  const cancelledUploadIds = useRef(new Set<string>())
  const consumeScrollTarget = useCallback(() => setScrollTargetId(null), [])
  // Sync route selection only when URL has a real chat id. On draft (null) we
  // intentionally keep ensureChatId's assigned id until navigation remounts.
  useEffect(() => {
    if (selectedChatId !== null) selectedChatIdRef.current = selectedChatId
  }, [selectedChatId])
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // Soft-nav between /chat/[id] reuses this component instance. Drop scroll
  // targets and re-enable deep links for the chat now on screen.
  const chatIdentity = chatRouteIdentity(selectedChatId)
  useEffect(() => {
    if (boundChatIdentityRef.current === chatIdentity) return
    boundChatIdentityRef.current = chatIdentity
    setScrollTargetId(null)
    nodeDeepLinkDone.current = false
  }, [chatIdentity])

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
  const activeStreams = useStreamStore((state) => state.active)

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
  const showMcpMenu = mcpAvailableForGeneration || attachments.length > 0
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
      clearComposer?: boolean
      modelConfig?: ModelConfigLocal
      /** Called after the stream is registered (response ok + startStream). */
      onStreamStarted?: () => void
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
      options?.onStreamStarted?.()
      if (options?.clearComposer && aliveRef.current) setComposer("")

      // Soft-follow may fail on a stale workspace cache (e.g. Edit-as-branch
      // already attached selection on the server, but the client tip is still
      // the previous branch). Re-check once after a forced refresh.
      const pathFromCache = () =>
        viewPathFromCache(
          queryClient,
          (input) => trpc.workspace.get.queryKey(input),
          body.chatId
        )
      const trySoftFollow = (path: NodeRow[]) =>
        nodeId !== "pending" &&
        shouldSoftFollow(body, path, selectedChatIdRef.current)
      let didSoftFollow = trySoftFollow(pathFromCache())
      if (!didSoftFollow) {
        // fetchQuery works even when the { chatId } workspace query is not
        // the active observer (e.g. still mounted on /chat/new draft).
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
      if (response.body) {
        await readStreamEvents(response.body, {
          onText: (delta) => appendText(streamId!, delta),
          onReasoning: (delta) => appendReasoning(streamId!, delta),
          onTool: (tool) => upsertTool(streamId!, tool),
        })
      }
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
   * Composer attach target.
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
    const content = composer.trim()
    if (!content && attachments.length === 0) return
    if (attachments.some((attachment) => attachment.uploading)) return
    if (!ensureModelReady(activeModelConfig)) return

    const contextLeafId = composerParentId
    const modelConfig = activeModelConfig
    const pendingAttachments = [...attachments]
    setComposer("")
    setAttachments([])
    attachmentsRef.current = []

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
          clearComposer: false,
          modelConfig,
          onStreamStarted: created
            ? () => {
                replaced = true
                router.replace(`/chat/${ensuredId}`)
              }
            : undefined,
        }
      )
      if (!started && aliveRef.current) {
        setComposer((prev) => prev || content)
        setAttachments((prev) => {
          const next = prev.length ? prev : pendingAttachments
          attachmentsRef.current = next
          return next
        })
      }
    } catch (error) {
      if (aliveRef.current) {
        setComposer((prev) => prev || content)
        setAttachments((prev) => {
          const next = prev.length ? prev : pendingAttachments
          attachmentsRef.current = next
          return next
        })
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

  async function uploadImages(files: FileList | File[]) {
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
    const imageCount = attachmentsRef.current.filter(
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
    attachmentsRef.current = [...attachmentsRef.current, ...placeholders]
    setAttachments(attachmentsRef.current)
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
        setAttachments((current) => {
          const next = current.map((item) =>
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
          attachmentsRef.current = next
          return next
        })
      } catch (error) {
        if (aliveRef.current) {
          setAttachments((current) => {
            const next = current.filter(
              (item) =>
                item.reference.kind !== "uploaded-file" ||
                item.reference.id !== localId
            )
            attachmentsRef.current = next
            return next
          })
          URL.revokeObjectURL(previewUrl)
          if (viewer?.src === previewUrl) setViewer(null)
          toast.error(
            error instanceof Error ? error.message : "Image upload failed"
          )
        }
      }
    }
  }

  function removeAttachment(part: ComposerAttachment) {
    if (part.uploading && part.reference.kind === "uploaded-file")
      cancelledUploadIds.current.add(part.reference.id)
    if (part.previewUrl && viewer?.src === part.previewUrl) setViewer(null)
    setAttachments((current) => {
      const next = current.filter((item) => item !== part)
      attachmentsRef.current = next
      return next
    })
    if (part.previewUrl) URL.revokeObjectURL(part.previewUrl)
    if (part.reference.kind === "uploaded-file" && !part.uploading)
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

  const streamsForActiveChat = Object.entries(activeStreams).filter(
    ([, stream]) => {
      // On /chat/new after first create, selectedChatId is still null but
      // pendingChatId holds the new id until replace remounts this tree.
      const viewId = selectedChatId ?? pendingChatId
      return (
        stream.chatId === viewId ||
        (data.chat !== null && stream.chatId === data.chat.id)
      )
    }
  )

  const pathVisibleStreams = streamsForActiveChat.filter(([, stream]) => {
    const place = streamPlacement(stream, activePath, data.nodes)
    return place === "inline" || place === "after-tip"
  })

  const streamByNodeId = new Map<string, [string, ActiveStream]>()
  for (const entry of streamsForActiveChat) {
    streamByNodeId.set(entry[1].nodeId, entry)
  }

  const afterTipStreams = streamsForActiveChat.filter(([, stream]) => {
    return streamPlacement(stream, activePath, data.nodes) === "after-tip"
  })

  const showEmpty =
    activePath.length === 0 &&
    pathVisibleStreams.length === 0 &&
    inFlightCount === 0

  const chatKey = selectedChatId ?? pendingChatId ?? "draft"
  const ariaBusy = inFlightCount > 0 || pathVisibleStreams.length > 0

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
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

      <ChatTranscript
        chatKey={chatKey}
        density={density}
        activePath={activePath}
        nodes={data.nodes}
        providers={providers}
        streamByNodeId={streamByNodeId}
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

      <div className="border-t border-border bg-background p-3 sm:px-6 sm:py-4">
        <div
          data-theme-target="composer"
          className={cn(
            "relative mx-auto rounded-xl border bg-card p-2",
            dropActive ? "border-foreground/40 bg-muted/40" : "border-border"
          )}
          style={{ maxWidth: "var(--composer-width, 48rem)" }}
          onDragEnter={(event) => {
            event.preventDefault()
            dropDepthRef.current += 1
            setDropActive(true)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            event.preventDefault()
            dropDepthRef.current = Math.max(0, dropDepthRef.current - 1)
            if (dropDepthRef.current === 0) setDropActive(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            dropDepthRef.current = 0
            setDropActive(false)
            if (event.dataTransfer.files.length)
              void uploadImages(event.dataTransfer.files)
          }}
        >
          {dropActive ? (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl bg-background/70 text-sm text-muted-foreground">
              Drop images
            </div>
          ) : null}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            className="sr-only"
            onChange={(event) => {
              if (event.target.files) void uploadImages(event.target.files)
              event.target.value = ""
            }}
          />
          {attachments.length > 0 ? (
            <div className="flex flex-wrap items-end gap-1.5 px-2 pt-1">
              {attachments.map((part) => {
                const key =
                  part.reference.kind === "mcp-resource"
                    ? `${part.reference.profileId}:${part.reference.uri}`
                    : part.reference.id
                if (part.previewUrl) {
                  return (
                    <span key={key} className="relative size-14 shrink-0">
                      <button
                        type="button"
                        className="size-14 overflow-hidden rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        onClick={() =>
                          setViewer({ src: part.previewUrl!, name: part.name })
                        }
                      >
                        <img
                          src={part.previewUrl}
                          alt={part.name}
                          className="size-full object-cover"
                        />
                      </button>
                      {part.uploading ? (
                        <span className="pointer-events-none absolute inset-0 grid place-items-center rounded-md bg-background/60">
                          <HugeiconsIcon
                            icon={Loading03Icon}
                            strokeWidth={2}
                            className="size-4 animate-spin"
                          />
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full border bg-background text-xs leading-none text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${part.name}`}
                        onClick={() => removeAttachment(part)}
                      >
                        ×
                      </button>
                    </span>
                  )
                }
                return (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-xs"
                  >
                    Attached: {part.name}
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`Remove ${part.name}`}
                      onClick={() => removeAttachment(part)}
                    >
                      ×
                    </button>
                  </span>
                )
              })}
            </div>
          ) : null}
          <Textarea
            value={composer}
            onChange={(event) => setComposer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void streamContinue()
              }
            }}
            placeholder="Message Nibchat…"
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files)
              if (files.length) {
                event.preventDefault()
                void uploadImages(files)
              }
            }}
            rows={3}
            className="min-h-[4.5rem] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-1">
            <div className="flex flex-wrap items-center gap-1">
              <TooltipProvider delay={400}>
                <WithTooltip label="Attach image">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="size-7"
                    aria-label="Attach image"
                    onClick={() => imageInputRef.current?.click()}
                  >
                    <HugeiconsIcon
                      icon={ImageAdd02Icon}
                      strokeWidth={2}
                      className="size-3.5"
                    />
                  </Button>
                </WithTooltip>
              </TooltipProvider>
              {showMcpMenu ? (
                <Popover open={mcpMenuOpen} onOpenChange={setMcpMenuOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                      />
                    }
                  >
                    MCP
                    {attachments.some(
                      (item) => item.reference.kind === "mcp-resource"
                    ) ? (
                      <span className="ml-1 text-muted-foreground">
                        ·{" "}
                        {
                          attachments.filter(
                            (item) => item.reference.kind === "mcp-resource"
                          ).length
                        }
                      </span>
                    ) : null}
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    side="top"
                    className="w-72 gap-0.5 p-1.5"
                  >
                    <button
                      type="button"
                      className="flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left hover:bg-muted/70"
                      onClick={() => {
                        setMcpMenuOpen(false)
                        setResourcePickerOpen(true)
                      }}
                    >
                      <span className="text-sm font-medium">
                        Attach resource
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Pull docs or files from an MCP server into this message
                      </span>
                    </button>
                    <button
                      type="button"
                      className="flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left hover:bg-muted/70"
                      onClick={() => {
                        setMcpMenuOpen(false)
                        setPromptPickerOpen(true)
                      }}
                    >
                      <span className="text-sm font-medium">Insert prompt</span>
                      <span className="text-xs text-muted-foreground">
                        Paste a server prompt template into the composer
                      </span>
                    </button>
                  </PopoverContent>
                </Popover>
              ) : null}
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                Enter to send · Shift + Enter for a new line
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {streamsForActiveChat.length > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5"
                  onClick={() =>
                    streamsForActiveChat.forEach(([id]) => stopStream(id))
                  }
                >
                  <HugeiconsIcon
                    icon={StopIcon}
                    strokeWidth={2}
                    className="size-4"
                  />
                  Stop
                </Button>
              )}
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => void streamContinue()}
                disabled={
                  (!composer.trim() && attachments.length === 0) ||
                  attachments.some((attachment) => attachment.uploading)
                }
              >
                <HugeiconsIcon
                  icon={SentIcon}
                  strokeWidth={2}
                  className="size-4"
                />
                Send
              </Button>
            </div>
          </div>
        </div>
      </div>

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
                        setAttachments((current) => {
                          if (
                            current.some(
                              (item) =>
                                item.reference.kind === "mcp-resource" &&
                                item.reference.profileId ===
                                  surface.profileId &&
                                item.reference.uri === resource.uri
                            )
                          )
                            return current
                          const next = [
                            ...current,
                            {
                              name: resource.name,
                              reference: {
                                kind: "mcp-resource" as const,
                                profileId: surface.profileId,
                                uri: resource.uri,
                              },
                            },
                          ]
                          attachmentsRef.current = next
                          return next
                        })
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
                          setComposer((current) =>
                            current.trim()
                              ? `${current.trim()}\n\n${result.text}`
                              : result.text
                          )
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
