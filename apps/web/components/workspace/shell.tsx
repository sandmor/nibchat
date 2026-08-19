"use client"

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { motion } from "motion/react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  Delete02Icon,
  MessageMultiple01Icon,
  Settings01Icon,
  SidebarLeft01Icon,
  SidebarRight01Icon,
} from "@hugeicons/core-free-icons"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TooltipProvider, WithTooltip } from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
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
import type { ChatRow } from "@/lib/types"
import { displayChatTitle } from "@/lib/chat-title"
import type { Appearance, ThemeRecord } from "@/lib/appearance"
import { defaultAppearance, motionTransition } from "@/lib/appearance"
import type { PromptStackDocument } from "@/lib/prompt-stack"
import { useAppearanceStore } from "@/lib/appearance-store"
import { activeThemeId } from "@/lib/theme-slot"
import { useThemeSlot } from "@/components/theme-provider"
import { useTRPC } from "@/lib/trpc-react"
import { omitChat, type WorkspaceData } from "@/lib/workspace-cache"
import type { ProviderSummary } from "./types"
import { ChatListItem } from "./chat-list"
import { BrandMark } from "@/components/logo"
import { AppearanceMagicChrome } from "./appearance-magic"
import { AppearanceRuntime } from "./appearance-runtime"

type ChromeContextValue = {
  appearance: Appearance
  themes: ThemeRecord[]
  lightThemeId: string
  darkThemeId: string
  activeThemeId: string
  providers: ProviderSummary[]
  refreshProviders: () => Promise<void>
}

const ChromeContext = createContext<ChromeContextValue | null>(null)

export function useWorkspaceChrome() {
  const value = useContext(ChromeContext)
  if (!value) {
    throw new Error("useWorkspaceChrome must be used within WorkspaceShell")
  }
  return value
}

type InstanceSettings = {
  themes: ThemeRecord[]
  lightThemeId: string
  darkThemeId: string
  defaultPromptStackId: string
  promptStacks: Array<{
    id: string
    name: string
    stack: PromptStackDocument
    created_at: string
    updated_at: string
  }>
  titleModelConfig: { providerId: string; model: string } | null
}

export function WorkspaceShell({
  initialChats,
  providers: initialProviders,
  initialSettings,
  children,
}: {
  initialChats: ChatRow[]
  providers: ProviderSummary[]
  initialSettings: InstanceSettings
  children: ReactNode
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const pathname = usePathname()
  const router = useRouter()
  const { resolved: resolvedSlot } = useThemeSlot()
  const [search, setSearch] = useState("")
  const [chatsOpen, setChatsOpen] = useState(false)
  const [chatIdToDelete, setChatIdToDelete] = useState<string | null>(null)
  const draftDensity = useAppearanceStore((s) => s.draft?.density)
  const draftMotion = useAppearanceStore((s) => s.draft?.motion)
  const draftMessageActions = useAppearanceStore((s) => s.draft?.messageActions)
  const draftModelPicker = useAppearanceStore((s) => s.draft?.modelPicker)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false
    try {
      return localStorage.getItem("nibchat.sidebarCollapsed") === "1"
    } catch {
      return false
    }
  })

  const chatsQuery = useQuery({
    ...trpc.workspace.get.queryOptions({ draft: true }),
    initialData: {
      chats: initialChats,
      chat: null,
      nodes: [],
    } satisfies WorkspaceData,
  })

  // Seed the shared getSettings cache with the full SSR payload. Partial
  // stubs (empty promptStacks) are treated as fresh for staleTime and make
  // every consumer think stacks are missing.
  const settingsQuery = useQuery({
    ...trpc.workspace.getSettings.queryOptions(),
    initialData: initialSettings,
  })
  const themes = settingsQuery.data.themes.length
    ? settingsQuery.data.themes
    : initialSettings.themes
  const lightId = settingsQuery.data.lightThemeId || initialSettings.lightThemeId
  const darkId = settingsQuery.data.darkThemeId || initialSettings.darkThemeId

  const providersQuery = useQuery({
    ...trpc.workspace.listProviders.queryOptions(),
    initialData: initialProviders,
  })

  const currentThemeId = activeThemeId({
    slot: resolvedSlot,
    lightThemeId: lightId,
    darkThemeId: darkId,
  })
  const activeTheme =
    themes.find((theme) => theme.id === currentThemeId) ?? themes[0]
  const activeAppearance = activeTheme?.document ?? defaultAppearance()
  // Color-only edits retain these nested references, so consumers of chrome do
  // not rerender while the picker is dragged.
  const appearance = useMemo(
    () => ({
      ...activeAppearance,
      density: draftDensity ?? activeAppearance.density,
      motion: draftMotion ?? activeAppearance.motion,
      messageActions: draftMessageActions ?? activeAppearance.messageActions,
      modelPicker: draftModelPicker ?? activeAppearance.modelPicker,
    }),
    [
      activeAppearance,
      draftDensity,
      draftMessageActions,
      draftModelPicker,
      draftMotion,
    ]
  )
  const transition = motionTransition(appearance.motion)

  function setSidebarCollapsedPersist(next: boolean) {
    setSidebarCollapsed(next)
    try {
      localStorage.setItem("nibchat.sidebarCollapsed", next ? "1" : "0")
    } catch {
      /* ignore */
    }
  }

  const searchQuery = useQuery({
    ...trpc.workspace.search.queryOptions({ query: search }),
    enabled: search.trim().length > 0,
  })

  const chats = chatsQuery.data?.chats ?? initialChats
  const results = searchQuery.data ?? []
  const providers = providersQuery.data ?? initialProviders
  const onSettings = pathname.startsWith("/settings")
  const activeChatId = pathname.startsWith("/chat/")
    ? pathname.slice("/chat/".length).split(/[/?#]/)[0]
    : null
  const isDraft = activeChatId === "new"
  const density = appearance.density
  const pad = density === "compact" ? "p-2 gap-1" : "p-3 gap-2"
  const collapsed = sidebarCollapsed
  const sidebarWidth = collapsed ? "3.5rem" : "17rem"

  // Remember last chat path while on /chat/* so “Chats” can return there from settings.
  const [lastChatHref, setLastChatHref] = useState("/chat/new")
  const pathChatHref =
    pathname === "/chat/new"
      ? "/chat/new"
      : pathname.startsWith("/chat/")
        ? pathname.split(/[?#]/)[0] || "/chat/new"
        : null
  if (pathChatHref !== null && pathChatHref !== lastChatHref) {
    setLastChatHref(pathChatHref)
  }
  const settingsHref = onSettings ? lastChatHref : "/settings"

  const chromeValue = useMemo(
    () => ({
      appearance,
      themes,
      lightThemeId: lightId,
      darkThemeId: darkId,
      activeThemeId: activeTheme?.id ?? currentThemeId,
      providers,
      refreshProviders: async () => {
        await queryClient.invalidateQueries(
          trpc.workspace.listProviders.queryFilter()
        )
      },
    }),
    [
      appearance,
      themes,
      lightId,
      darkId,
      activeTheme?.id,
      currentThemeId,
      providers,
      queryClient,
      trpc,
    ]
  )

  const deleteChatMutation = useMutation(
    trpc.workspace.deleteChat.mutationOptions({
      onMutate: async (input) => {
        await queryClient.cancelQueries(trpc.workspace.get.queryFilter())
        const snapshots = queryClient.getQueriesData<WorkspaceData>({
          queryKey: trpc.workspace.get.queryKey(),
        })
        for (const [key, data] of snapshots) {
          queryClient.setQueryData(key, omitChat(data, input.chatId))
        }
        return { snapshots }
      },
      onError: (_error, _input, context) => {
        if (context?.snapshots) {
          for (const [key, data] of context.snapshots) {
            queryClient.setQueryData(key, data)
          }
        }
        toast.error("Could not delete conversation")
      },
      onSuccess: (_result, input) => {
        if (activeChatId === input.chatId) {
          router.replace("/chat/new")
        }
      },
      onSettled: async () => {
        await queryClient.invalidateQueries(trpc.workspace.get.queryFilter())
        setChatIdToDelete(null)
      },
    })
  )

  return (
    <ChromeContext.Provider value={chromeValue}>
      <AppearanceRuntime
        themes={themes}
        activeThemeId={currentThemeId}
        fallback={activeAppearance}
      />
      <div className="flex h-svh flex-col bg-background text-foreground">
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
            <BrandMark logoClassName="size-6" />
          </div>
          <WithTooltip label={onSettings ? "Back to chat" : "Settings"}>
            <Link
              href={settingsHref}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              aria-label={onSettings ? "Back to chat" : "Settings"}
            >
              <HugeiconsIcon
                icon={onSettings ? MessageMultiple01Icon : Settings01Icon}
                strokeWidth={2}
                className="size-4"
                aria-hidden
              />
            </Link>
          </WithTooltip>
        </div>

        <div className="flex min-h-0 flex-1">
          <motion.aside
            data-theme-group="sidebar"
            data-theme-target="sidebar"
            className={cn(
              "hidden min-h-0 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex",
              pad
            )}
            initial={false}
            animate={{ width: sidebarWidth }}
            transition={transition}
          >
            <TooltipProvider delay={400}>
              <div
                className={cn(
                  "mb-3 flex min-w-0 items-center",
                  collapsed ? "flex-col gap-2" : "justify-between px-1"
                )}
              >
                {collapsed ? (
                  <WithTooltip label="nibchat" side="right">
                    <span className="inline-flex">
                      <BrandMark wordmark={false} logoClassName="size-7" />
                    </span>
                  </WithTooltip>
                ) : (
                  <BrandMark logoClassName="size-6" />
                )}
                <div
                  className={cn(
                    "flex",
                    collapsed ? "flex-col gap-1" : "gap-0.5"
                  )}
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
                        icon={
                          collapsed ? SidebarRight01Icon : SidebarLeft01Icon
                        }
                        strokeWidth={2}
                        className="size-4"
                        aria-hidden
                      />
                    </Button>
                  </WithTooltip>
                  {!collapsed && (
                    <Link
                      href={settingsHref}
                      className={buttonVariants({
                        variant: "ghost",
                        size: "sm",
                      })}
                    >
                      {onSettings ? "Chats" : "Settings"}
                    </Link>
                  )}
                  {collapsed && (
                    <WithTooltip label={onSettings ? "Chats" : "Settings"}>
                      <Link
                        href={settingsHref}
                        className={buttonVariants({
                          variant: "ghost",
                          size: "icon-sm",
                        })}
                        aria-label={onSettings ? "Chats" : "Settings"}
                      >
                        <HugeiconsIcon
                          icon={
                            onSettings ? MessageMultiple01Icon : Settings01Icon
                          }
                          strokeWidth={2}
                          className="size-4"
                          aria-hidden
                        />
                      </Link>
                    </WithTooltip>
                  )}
                </div>
              </div>
            </TooltipProvider>
            {!collapsed ? (
              <>
                <Link
                  href="/chat/new"
                  data-theme-group="button"
                  data-theme-target="button"
                  className={cn(buttonVariants(), "mb-3 w-full gap-1.5")}
                >
                  <HugeiconsIcon
                    icon={Add01Icon}
                    strokeWidth={2}
                    className="size-4"
                    aria-hidden
                  />
                  New conversation
                </Link>
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search every branch"
                  aria-label="Search every branch"
                  className="mb-2"
                />
              </>
            ) : (
              <WithTooltip label="New conversation" side="right">
                <Link
                  href="/chat/new"
                  data-theme-group="button"
                  data-theme-target="button"
                  className={cn(
                    buttonVariants({ size: "icon" }),
                    "mb-2 w-full"
                  )}
                  aria-label="New conversation"
                >
                  <HugeiconsIcon
                    icon={Add01Icon}
                    strokeWidth={2}
                    className="size-4"
                    aria-hidden
                  />
                </Link>
              </WithTooltip>
            )}
            {results.length > 0 && !collapsed && (
              <ScrollArea className="mb-2 max-h-40 rounded-lg border bg-background">
                <div className="space-y-1 p-1">
                  {results.map((result) => (
                    <Link
                      key={result.id}
                      href={`/chat/${result.chat_id}?node=${encodeURIComponent(result.id)}`}
                      onClick={() => setSearch("")}
                      className={cn(
                        buttonVariants({ variant: "ghost" }),
                        "h-auto w-full flex-col items-start gap-0.5 px-2 py-2 text-left"
                      )}
                    >
                      <span className="font-medium">
                        {displayChatTitle(result.title)}
                      </span>
                      <span className="w-full truncate text-xs text-muted-foreground">
                        {result.search_text}
                      </span>
                    </Link>
                  ))}
                </div>
              </ScrollArea>
            )}
            <ScrollArea className="min-h-0 flex-1">
              <TooltipProvider delay={400}>
                <div className="space-y-1">
                  {chats.map((chat) => (
                    <ChatListItem
                      key={chat.id}
                      chat={chat}
                      compact={collapsed}
                      active={!isDraft && activeChatId === chat.id}
                      onDelete={setChatIdToDelete}
                    />
                  ))}
                </div>
              </TooltipProvider>
            </ScrollArea>
          </motion.aside>

          <div
            data-theme-group="app"
            data-theme-target="app-background"
            className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-app-background"
          >
            {children}
          </div>
        </div>

        <Dialog open={chatsOpen} onOpenChange={setChatsOpen}>
          <DialogContent className="flex max-h-[90svh] flex-col gap-3 sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Conversations</DialogTitle>
            </DialogHeader>
            <Link
              href="/chat/new"
              data-theme-group="button"
              data-theme-target="button"
              onClick={() => setChatsOpen(false)}
              className={cn(buttonVariants(), "w-full gap-1.5")}
            >
              <HugeiconsIcon
                icon={Add01Icon}
                strokeWidth={2}
                className="size-4"
              />
              New conversation
            </Link>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search every branch"
              aria-label="Search every branch"
            />
            {results.length > 0 && (
              <ScrollArea className="max-h-32 rounded-lg border">
                <div className="space-y-1 p-1">
                  {results.map((result) => (
                    <Link
                      key={result.id}
                      href={`/chat/${result.chat_id}?node=${encodeURIComponent(result.id)}`}
                      onClick={() => {
                        setSearch("")
                        setChatsOpen(false)
                      }}
                      className={cn(
                        buttonVariants({ variant: "ghost" }),
                        "h-auto w-full flex-col items-start gap-0.5 px-2 py-2 text-left"
                      )}
                    >
                      <span className="font-medium">
                        {displayChatTitle(result.title)}
                      </span>
                      <span className="w-full truncate text-xs text-muted-foreground">
                        {result.search_text}
                      </span>
                    </Link>
                  ))}
                </div>
              </ScrollArea>
            )}
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-1 pr-2">
                {chats.map((chat) => (
                  <div key={chat.id} className="flex items-center gap-0.5">
                    <Link
                      href={`/chat/${chat.id}`}
                      onClick={() => setChatsOpen(false)}
                      className={cn(
                        buttonVariants({
                          variant:
                            !isDraft && activeChatId === chat.id
                              ? "secondary"
                              : "ghost",
                        }),
                        "h-auto min-w-0 flex-1 justify-start px-3 py-2 text-left"
                      )}
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate">
                          {displayChatTitle(chat.title)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(chat.updated_at).toLocaleDateString()}
                        </span>
                      </span>
                    </Link>
                    <WithTooltip label="Delete conversation">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${displayChatTitle(chat.title)}`}
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
                Permanently delete this conversation and every branch. This
                cannot be undone.
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
      <AppearanceMagicChrome />
    </ChromeContext.Provider>
  )
}
