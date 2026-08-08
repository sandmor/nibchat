"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  Delete02Icon,
  MessageMultiple01Icon,
  SentIcon,
  Settings01Icon,
  SidebarLeft01Icon,
  SidebarRight01Icon,
  StopIcon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TooltipProvider, WithTooltip } from "@/components/ui/tooltip"
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
import { useStreamStore } from "@/lib/stream-store"
import { useTRPC } from "@/lib/trpc-react"
import {
  omitChat,
  patchChatTitle,
  patchSelection,
  workspaceInput,
  type WorkspaceData,
} from "@/lib/workspace-cache"
import type { ResolvedAppearance } from "@/lib/appearance"
import { motionTransition, shouldAnimate } from "@/lib/appearance"
import { Markdown } from "@/components/markdown"
import type { ModelConfigLocal, ProviderSummary } from "./types"
import { seedDraftModelConfig, usePrefersReducedMotion } from "./hooks"
import { ModelPicker } from "./model-picker"
import { GenerationParameters } from "./generation-parameters"
import { Message } from "./message"
import { Empty } from "./empty"
import { SettingsPanel } from "./settings/panel"
import { ChatListItem } from "./chat-list"
import {
  readStreamEvents,
  shouldSoftFollow,
  viewPathFromCache,
  type StreamRequestBody,
} from "./stream-helpers"

type Props = {
  initial: WorkspaceData
  providers: ProviderSummary[]
  appearance: ResolvedAppearance
}

export function Workspace({
  initial,
  providers: initialProviders,
  appearance: initialAppearance,
}: Props) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  /** null = draft (no chat until first send); string = active chat id */
  const [selectedChatId, setSelectedChatId] = useState<string | null>(
    initial.chat?.id ?? null
  )
  const [composer, setComposer] = useState("")
  const [panel, setPanel] = useState<"chat" | "settings">("chat")
  const [search, setSearch] = useState("")
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameTitle, setRenameTitle] = useState("")
  const [chatIdToDelete, setChatIdToDelete] = useState<string | null>(null)
  const [chatsOpen, setChatsOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false
    try {
      return localStorage.getItem("vero.sidebarCollapsed") === "1"
    } catch {
      return false
    }
  })
  const [appearance, setAppearance] = useState(initialAppearance)
  const [draftModelConfig, setDraftModelConfig] = useState<ModelConfigLocal>(
    () => seedDraftModelConfig(initial.chats, initialProviders)
  )
  const [inFlightCount, setInFlightCount] = useState(0)
  const createChatLock = useRef<Promise<string> | null>(null)
  const selectedChatIdRef = useRef(selectedChatId)
  useEffect(() => {
    selectedChatIdRef.current = selectedChatId
  }, [selectedChatId])
  const prefersReduced = usePrefersReducedMotion()
  const animate = shouldAnimate(appearance.motion, prefersReduced)
  const transition = motionTransition(appearance.motion)

  useEffect(() => {
    const root = document.documentElement
    const applied = Object.keys(appearance.vars)
    for (const [key, value] of Object.entries(appearance.vars)) {
      root.style.setProperty(key, value)
    }
    root.dataset.density = appearance.density
    return () => {
      for (const key of applied) root.style.removeProperty(key)
      delete root.dataset.density
    }
  }, [appearance.vars, appearance.density])

  useEffect(() => {
    const id = "vero-remote-appearance"
    if (!appearance.remoteStylesheet) {
      document.getElementById(id)?.remove()
      return
    }
    let link = document.getElementById(id) as HTMLLinkElement | null
    if (!link) {
      link = document.createElement("link")
      link.id = id
      link.rel = "stylesheet"
      document.head.appendChild(link)
    }
    link.href = appearance.remoteStylesheet
  }, [appearance.remoteStylesheet])

  useEffect(() => {
    return () => {
      document.getElementById("vero-remote-appearance")?.remove()
    }
  }, [])

  function setSidebarCollapsedPersist(next: boolean) {
    setSidebarCollapsed(next)
    try {
      localStorage.setItem("vero.sidebarCollapsed", next ? "1" : "0")
    } catch {
      /* ignore */
    }
  }

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
    initialData:
      selectedChatId === (initial.chat?.id ?? null) ? initial : undefined,
  })

  const providersQuery = useQuery({
    ...trpc.workspace.listProviders.queryOptions(),
    initialData: initialProviders,
  })

  const searchQuery = useQuery({
    ...trpc.workspace.search.queryOptions({ query: search }),
    enabled: search.trim().length > 0,
  })

  // Never fall back to SSR initial when it shows a different chat than the
  // selected one — that flash of an old conversation was using mismatched data.
  const knownChats = workspaceQuery.data?.chats ?? initial.chats
  const data: WorkspaceData = useMemo(() => {
    if (workspaceQuery.data) {
      // Guard: refuse cached payload that belongs to another selection
      if (selectedChatId === null) {
        if (workspaceQuery.data.chat === null) return workspaceQuery.data
        return { chats: workspaceQuery.data.chats, chat: null, nodes: [] }
      }
      if (workspaceQuery.data.chat?.id === selectedChatId)
        return workspaceQuery.data
      return {
        chats: workspaceQuery.data.chats,
        chat: null,
        nodes: [],
      }
    }
    if (selectedChatId === null)
      return { chats: knownChats, chat: null, nodes: [] }
    if (selectedChatId === (initial.chat?.id ?? null) && initial.chat)
      return initial
    return { chats: knownChats, chat: null, nodes: [] }
  }, [workspaceQuery.data, selectedChatId, initial, knownChats])

  const providers = providersQuery.data ?? initialProviders
  const results = searchQuery.data ?? []

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
        const key = trpc.workspace.get.queryKey(workspaceKeyInput)
        const previous = queryClient.getQueryData(key)
        if (input.title)
          queryClient.setQueryData(
            key,
            patchChatTitle(previous, input.chatId, input.title)
          )
        return { previous, key }
      },
      onError: (_error, _input, context) => {
        if (context?.previous)
          queryClient.setQueryData(context.key, context.previous)
        toast.error("Could not update conversation")
      },
      onSettled: async () => {
        await invalidateWorkspace()
      },
    })
  )

  const deleteChatMutation = useMutation(
    trpc.workspace.deleteChat.mutationOptions({
      onMutate: async (input) => {
        await queryClient.cancelQueries(trpc.workspace.get.queryFilter())
        const key = trpc.workspace.get.queryKey(workspaceKeyInput)
        const previous = queryClient.getQueryData(key)
        const next = omitChat(previous, input.chatId)
        queryClient.setQueryData(key, next)
        if (selectedChatId === input.chatId) setSelectedChatId(null)
        return { previous, key }
      },
      onError: (_error, _input, context) => {
        if (context?.previous)
          queryClient.setQueryData(context.key, context.previous)
        toast.error("Could not delete conversation")
      },
      onSettled: async () => {
        await invalidateWorkspace()
        setChatIdToDelete(null)
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
      onSuccess: async (_result, input) => {
        setSelectedChatId(input.chatId)
        await invalidateWorkspace()
      },
    })
  )

  const density = appearance.density
  const pad = density === "compact" ? "p-2 gap-1" : "p-3 gap-2"
  const messagePad =
    density === "compact" ? "p-3 sm:p-4 space-y-3" : "p-5 sm:p-8 space-y-5"
  const collapsed = sidebarCollapsed

  const activePath = useMemo(
    () =>
      data.chat
        ? resolveActivePath(data.nodes, data.chat.selected_root_node_id)
        : [],
    [data]
  )

  const streamingNodeIds = useMemo(
    () =>
      new Set(
        Object.values(activeStreams)
          .filter((stream) => stream.chatId === data.chat?.id)
          .map((stream) => stream.nodeId)
      ),
    [activeStreams, data.chat?.id]
  )

  async function refresh(chatId?: string | null) {
    if (chatId !== undefined) setSelectedChatId(chatId)
    await invalidateWorkspace()
  }

  async function refreshProviders() {
    await queryClient.invalidateQueries(
      trpc.workspace.listProviders.queryFilter()
    )
  }

  function newChat() {
    setSelectedChatId(null)
    setPanel("chat")
    setComposer("")
    setDraftModelConfig(seedDraftModelConfig(data.chats, providers))
  }

  function searchMessages(value: string) {
    setSearch(value)
  }

  function ensureModelReady(config: ModelConfigLocal) {
    if (!config.providerId || !config.model) {
      toast.error("Choose a provider and model before sending a message.")
      return false
    }
    return true
  }

  async function runStream(
    body: StreamRequestBody,
    options?: { clearComposer?: boolean; modelConfig?: ModelConfigLocal }
  ) {
    const modelConfig = options?.modelConfig ?? activeModelConfig
    if (!ensureModelReady(modelConfig)) return
    let streamId: string | undefined
    setInFlightCount((n) => n + 1)
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
      startStream(streamId, { nodeId, chatId: body.chatId })
      if (options?.clearComposer) setComposer("")

      const pathNow = viewPathFromCache(
        queryClient,
        (input) => trpc.workspace.get.queryKey(input),
        body.chatId
      )
      if (
        nodeId !== "pending" &&
        shouldSoftFollow(body, pathNow, selectedChatIdRef.current)
      ) {
        await selectPathMutation.mutateAsync({
          chatId: body.chatId,
          nodeId,
        })
      } else {
        await queryClient.invalidateQueries({
          queryKey: trpc.workspace.get.queryKey({ chatId: body.chatId }),
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
        toast.error(error instanceof Error ? error.message : "Stream failed")
        await queryClient.invalidateQueries({
          queryKey: trpc.workspace.get.queryKey({ chatId: body.chatId }),
        })
      }
    } finally {
      setInFlightCount((n) => Math.max(0, n - 1))
      if (streamId) finishStream(streamId)
    }
  }

  async function ensureChatId(
    modelConfig: ModelConfigLocal
  ): Promise<{ chatId: string; created: boolean }> {
    if (data.chat?.id) return { chatId: data.chat.id, created: false }
    if (selectedChatId) return { chatId: selectedChatId, created: false }

    // Serialize draft creates so parallel first-sends don't open two chats.
    if (!createChatLock.current) {
      createChatLock.current = createChatMutation
        .mutateAsync({ config: modelConfig })
        .then((chat) => {
          setSelectedChatId(chat.id)
          selectedChatIdRef.current = chat.id
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
    const chatId = await createChatLock.current
    return { chatId, created: true }
  }

  async function streamContinue() {
    const content = composer.trim()
    if (!content) return
    if (!ensureModelReady(activeModelConfig)) return

    const contextLeafId = activePath.at(-1)?.id ?? null
    const modelConfig = activeModelConfig
    setComposer("")

    try {
      const { chatId, created } = await ensureChatId(modelConfig)
      await runStream(
        {
          chatId,
          intent: "continue",
          parentNodeId: created ? null : contextLeafId,
          content,
        },
        { clearComposer: false, modelConfig }
      )
    } catch (error) {
      // Restore text if create failed before stream
      setComposer((prev) => prev || content)
      toast.error(
        error instanceof Error ? error.message : "Could not start conversation"
      )
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
    ([, stream]) =>
      (data.chat && stream.chatId === data.chat.id) ||
      (selectedChatId !== null && stream.chatId === selectedChatId)
  )
  const showEmpty =
    activePath.length === 0 &&
    streamsForActiveChat.length === 0 &&
    inFlightCount === 0

  const sidebarWidth = collapsed ? "3.5rem" : "17rem"

  return (
    <div className="flex h-svh flex-col bg-background text-foreground">
      {/* Mobile app bar */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-3 md:hidden">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setChatsOpen(true)}
            aria-label="Conversations"
          >
            <HugeiconsIcon
              icon={MessageMultiple01Icon}
              strokeWidth={2}
              className="size-4"
            />
            <span className="ml-1.5">Chats</span>
          </Button>
          <span className="font-semibold tracking-tight">vero</span>
        </div>
        <WithTooltip label={panel === "settings" ? "Back to chat" : "Settings"}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPanel(panel === "settings" ? "chat" : "settings")}
            aria-label={panel === "settings" ? "Back to chat" : "Settings"}
          >
            <HugeiconsIcon
              icon={
                panel === "settings" ? MessageMultiple01Icon : Settings01Icon
              }
              strokeWidth={2}
              className="size-4"
              aria-hidden
            />
          </Button>
        </WithTooltip>
      </div>

      <div className="flex min-h-0 flex-1">
        <motion.aside
          className={cn(
            "hidden min-h-0 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar text-sidebar-foreground md:flex",
            pad
          )}
          initial={false}
          animate={{ width: sidebarWidth }}
          transition={transition}
        >
          <div
            className={cn(
              "mb-3 flex min-w-0 items-center",
              collapsed ? "flex-col gap-2" : "justify-between px-1"
            )}
          >
            <span
              className={cn(
                "font-semibold tracking-tight",
                collapsed && "text-sm"
              )}
            >
              {collapsed ? "v" : "vero"}
            </span>
            <TooltipProvider delay={400}>
              <div
                className={cn("flex", collapsed ? "flex-col gap-1" : "gap-0.5")}
              >
                <WithTooltip
                  label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={
                      collapsed ? "Expand sidebar" : "Collapse sidebar"
                    }
                    aria-expanded={!collapsed}
                    onClick={() => setSidebarCollapsedPersist(!collapsed)}
                  >
                    <HugeiconsIcon
                      icon={collapsed ? SidebarRight01Icon : SidebarLeft01Icon}
                      strokeWidth={2}
                      className="size-4"
                      aria-hidden
                    />
                  </Button>
                </WithTooltip>
                {!collapsed && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setPanel(panel === "settings" ? "chat" : "settings")
                    }
                  >
                    {panel === "settings" ? "Chats" : "Settings"}
                  </Button>
                )}
                {collapsed && (
                  <WithTooltip
                    label={panel === "settings" ? "Chats" : "Settings"}
                  >
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={panel === "settings" ? "Chats" : "Settings"}
                      onClick={() =>
                        setPanel(panel === "settings" ? "chat" : "settings")
                      }
                    >
                      <HugeiconsIcon
                        icon={
                          panel === "settings"
                            ? MessageMultiple01Icon
                            : Settings01Icon
                        }
                        strokeWidth={2}
                        className="size-4"
                        aria-hidden
                      />
                    </Button>
                  </WithTooltip>
                )}
              </div>
            </TooltipProvider>
          </div>
          {!collapsed ? (
            <>
              <Button onClick={newChat} className="mb-3 w-full gap-1.5">
                <HugeiconsIcon
                  icon={Add01Icon}
                  strokeWidth={2}
                  className="size-4"
                  aria-hidden
                />
                New conversation
              </Button>
              <Input
                value={search}
                onChange={(event) => searchMessages(event.target.value)}
                placeholder="Search every branch"
                aria-label="Search every branch"
                className="mb-2"
              />
            </>
          ) : (
            <WithTooltip label="New conversation" side="right">
              <Button
                size="icon"
                onClick={newChat}
                className="mb-2 w-full"
                aria-label="New conversation"
              >
                <HugeiconsIcon
                  icon={Add01Icon}
                  strokeWidth={2}
                  className="size-4"
                  aria-hidden
                />
              </Button>
            </WithTooltip>
          )}
          {results.length > 0 && !collapsed && (
            <ScrollArea className="mb-2 max-h-40 rounded-lg border bg-background">
              <div className="space-y-1 p-1">
                {results.map((result) => (
                  <Button
                    key={result.id}
                    variant="ghost"
                    className="h-auto w-full flex-col items-start gap-0.5 px-2 py-2 text-left"
                    onClick={async () => {
                      selectPathMutation.mutate({
                        chatId: result.chat_id,
                        nodeId: result.id,
                      })
                      setSearch("")
                    }}
                  >
                    <span className="font-medium">{result.title}</span>
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {result.search_text}
                    </span>
                  </Button>
                ))}
              </div>
            </ScrollArea>
          )}
          <ScrollArea className="min-h-0 flex-1">
            <TooltipProvider delay={400}>
              <div className="space-y-1">
                {data.chats.map((chat) => (
                  <ChatListItem
                    key={chat.id}
                    chat={chat}
                    compact={collapsed}
                    active={data.chat?.id === chat.id}
                    onSelect={(id) => void refresh(id)}
                    onDelete={setChatIdToDelete}
                  />
                ))}
              </div>
            </TooltipProvider>
          </ScrollArea>
        </motion.aside>

        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            {panel === "settings" ? (
              <motion.div
                key="settings"
                className="absolute inset-0 flex min-h-0 flex-col overflow-hidden"
                initial={animate ? { opacity: 0, x: 12 } : false}
                animate={{ opacity: 1, x: 0 }}
                exit={animate ? { opacity: 0, x: -12 } : undefined}
                transition={transition}
              >
                <SettingsPanel
                  providers={providers}
                  appearance={appearance}
                  onProvidersChange={refreshProviders}
                  onAppearanceChange={setAppearance}
                />
              </motion.div>
            ) : (
              <motion.section
                key="chat"
                className="absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden"
                initial={animate ? { opacity: 0, x: -12 } : false}
                animate={{ opacity: 1, x: 0 }}
                exit={animate ? { opacity: 0, x: 12 } : undefined}
                transition={transition}
              >
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
                      className={cn(
                        "truncate font-medium",
                        data.chat && "cursor-text"
                      )}
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
                      onManageProviders={() => setPanel("settings")}
                    />
                    <GenerationParameters
                      key={`${data.chat?.id ?? "draft"}:${activeModelConfig.providerId ?? ""}:${activeModelConfig.model ?? ""}`}
                      config={activeModelConfig}
                      chatId={data.chat?.id}
                      onChange={(config) => void commitModelConfig(config)}
                    />
                  </div>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  <div
                    className={cn("mx-auto min-w-0", messagePad)}
                    style={{
                      maxWidth: "var(--message-width, 48rem)",
                    }}
                  >
                    <AnimatePresence mode="sync" initial={false}>
                      {showEmpty && (
                        <motion.div
                          key="empty"
                          initial={animate ? { opacity: 0 } : false}
                          animate={{ opacity: 1 }}
                          exit={animate ? { opacity: 0 } : undefined}
                          transition={transition}
                        >
                          <Empty providers={providers} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                    {activePath.map((node, pathIndex) =>
                      streamingNodeIds.has(node.id) &&
                      node.status === "streaming" ? null : (
                        <Message
                          key={`path-${pathIndex}`}
                          node={node}
                          nodes={data.nodes}
                          providers={providers}
                          animate={animate}
                          transition={transition}
                          messageActionCaptions={
                            appearance.messageActions.captions
                          }
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
                          }}
                          onChanged={() => refresh(data.chat?.id ?? null)}
                          onRegenerate={
                            node.role === "assistant"
                              ? () => streamRegenerate(node.id)
                              : undefined
                          }
                          onGenerateUnder={streamGenerate}
                        />
                      )
                    )}
                    {streamsForActiveChat.map(([streamId, stream]) => (
                      <motion.article
                        key={streamId}
                        className="min-w-0 overflow-hidden rounded-xl border bg-card p-4"
                        initial={animate ? { opacity: 0, y: 6 } : false}
                        animate={{ opacity: 1, y: 0 }}
                        transition={transition}
                      >
                        <div className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                          assistant · streaming
                        </div>
                        {stream.reasoning && (
                          <details className="mb-3 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                            <summary className="cursor-pointer">
                              Reasoning
                            </summary>
                            <p className="mt-2 whitespace-pre-wrap">
                              {stream.reasoning}
                            </p>
                          </details>
                        )}
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <Markdown>{stream.text || "Thinking…"}</Markdown>
                        </div>
                      </motion.article>
                    ))}
                  </div>
                </div>

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
                              streamsForActiveChat.forEach(([id]) =>
                                stopStream(id)
                              )
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
              </motion.section>
            )}
          </AnimatePresence>
        </div>
      </div>

      <Dialog open={chatsOpen} onOpenChange={setChatsOpen}>
        <DialogContent className="flex max-h-[90svh] flex-col gap-3 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Conversations</DialogTitle>
          </DialogHeader>
          <Button
            onClick={() => {
              newChat()
              setChatsOpen(false)
            }}
            className="w-full gap-1.5"
          >
            <HugeiconsIcon
              icon={Add01Icon}
              strokeWidth={2}
              className="size-4"
            />
            New conversation
          </Button>
          <Input
            value={search}
            onChange={(event) => searchMessages(event.target.value)}
            placeholder="Search every branch"
            aria-label="Search every branch"
          />
          {results.length > 0 && (
            <ScrollArea className="max-h-32 rounded-lg border">
              <div className="space-y-1 p-1">
                {results.map((result) => (
                  <Button
                    key={result.id}
                    variant="ghost"
                    className="h-auto w-full flex-col items-start gap-0.5 px-2 py-2 text-left"
                    onClick={() => {
                      selectPathMutation.mutate({
                        chatId: result.chat_id,
                        nodeId: result.id,
                      })
                      setSearch("")
                      setChatsOpen(false)
                      setPanel("chat")
                    }}
                  >
                    <span className="font-medium">{result.title}</span>
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {result.search_text}
                    </span>
                  </Button>
                ))}
              </div>
            </ScrollArea>
          )}
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-1 pr-2">
              {data.chats.map((chat) => (
                <div key={chat.id} className="flex items-center gap-0.5">
                  <Button
                    variant={data.chat?.id === chat.id ? "secondary" : "ghost"}
                    className="h-auto min-w-0 flex-1 justify-start px-3 py-2 text-left"
                    onClick={() => {
                      void refresh(chat.id)
                      setChatsOpen(false)
                      setPanel("chat")
                    }}
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate">{chat.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(chat.updated_at).toLocaleDateString()}
                      </span>
                    </span>
                  </Button>
                  <WithTooltip label="Delete conversation">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${chat.title}`}
                      onClick={() => setChatIdToDelete(chat.id)}
                    >
                      <HugeiconsIcon
                        icon={Delete02Icon}
                        strokeWidth={2}
                        className="size-4"
                        aria-hidden
                      />
                    </Button>
                  </WithTooltip>
                </div>
              ))}
            </div>
          </ScrollArea>
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

      <AlertDialog
        open={chatIdToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setChatIdToDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete this conversation and every branch. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!chatIdToDelete) return
                await deleteChatMutation.mutateAsync({
                  chatId: chatIdToDelete,
                })
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
