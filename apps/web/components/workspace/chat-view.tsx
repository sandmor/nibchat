"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { SentIcon, StopIcon } from "@hugeicons/core-free-icons"
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
import { ChatTranscript } from "./chat-transcript"
import { chatRouteIdentity } from "./chat-transcript-helpers"
import { useWorkspaceChrome } from "./shell"
import { DocumentTitle } from "@/components/document-title"
import type { NodeRow } from "@/lib/types"
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

export function ChatView({ mode, chatId, initial, selectNodeId }: Props) {
  const { appearance, providers: chromeProviders } = useWorkspaceChrome()
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useRouter()
  /** URL-derived selection: null when drafting, string when on /chat/[id] */
  const selectedChatId = mode === "draft" ? null : chatId
  const [composer, setComposer] = useState("")
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameTitle, setRenameTitle] = useState("")
  const [draftModelConfig, setDraftModelConfig] = useState<ModelConfigLocal>(
    () => seedDraftModelConfig(initial.chats, chromeProviders)
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
    if (!ensureModelReady(modelConfig)) return
    let streamId: string | undefined
    if (aliveRef.current) setInFlightCount((n) => n + 1)
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
      const nodeId = response.headers.get("X-Vero-Assistant-Node") ?? "pending"
      const parentHeader = response.headers.get("X-Vero-Parent-Node")
      const userNodeId = response.headers.get("X-Vero-User-Node")
      // Prefer structural parent from the server; fall back to request body.
      const parentNodeId =
        parentHeader ??
        (body.intent === "continue"
          ? userNodeId
          : body.intent === "generate"
            ? body.parentNodeId
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
        })
      }
      await queryClient.invalidateQueries({
        queryKey: trpc.workspace.get.queryKey({ chatId: body.chatId }),
      })
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
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
        .mutateAsync({ config: modelConfig })
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

  async function streamContinue() {
    const content = composer.trim()
    if (!content) return
    if (!ensureModelReady(activeModelConfig)) return

    const contextLeafId = activePath.at(-1)?.id ?? null
    const modelConfig = activeModelConfig
    setComposer("")

    let ensuredId: string | null = null
    let created = false
    let replaced = false
    try {
      const ensured = await ensureChatId(modelConfig)
      ensuredId = ensured.chatId
      created = ensured.created
      // Start the stream before URL replace so remount sees Zustand state.
      await runStream(
        {
          chatId: ensuredId,
          intent: "continue",
          parentNodeId: created ? null : contextLeafId,
          content,
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
    } catch (error) {
      if (aliveRef.current) {
        setComposer((prev) => prev || content)
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
  const ariaBusy =
    inFlightCount > 0 || pathVisibleStreams.length > 0

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
        <div className="flex min-w-0 items-center gap-0.5 sm:max-w-[min(28rem,55%)] sm:shrink-0 sm:gap-1">
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
      />

      <div className="border-t border-border bg-background p-3 sm:px-6 sm:py-4">
        <div
          className="mx-auto rounded-xl border border-border bg-card p-2"
          style={{ maxWidth: "var(--composer-width, 48rem)" }}
        >
          <Textarea
            value={composer}
            onChange={(event) => setComposer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void streamContinue()
              }
            }}
            placeholder="Message Vero…"
            rows={3}
            className="min-h-[4.5rem] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-between px-2 pb-1">
            <span className="text-[11px] text-muted-foreground">
              Enter to send · Shift + Enter for a new line
            </span>
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
                disabled={!composer.trim()}
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
