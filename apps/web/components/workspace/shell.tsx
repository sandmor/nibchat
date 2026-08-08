"use client"

import {
  createContext,
  useContext,
  useEffect,
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
import type { ResolvedAppearance } from "@/lib/appearance"
import { motionTransition } from "@/lib/appearance"
import { useTRPC } from "@/lib/trpc-react"
import { omitChat, type WorkspaceData } from "@/lib/workspace-cache"
import type { ProviderSummary } from "./types"
import { ChatListItem } from "./chat-list"

type ChromeContextValue = {
  appearance: ResolvedAppearance
  setAppearance: (next: ResolvedAppearance) => void
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

export function WorkspaceShell({
  initialChats,
  providers: initialProviders,
  appearance: initialAppearance,
  children,
}: {
  initialChats: ChatRow[]
  providers: ProviderSummary[]
  appearance: ResolvedAppearance
  children: ReactNode
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const pathname = usePathname()
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [chatsOpen, setChatsOpen] = useState(false)
  const [chatIdToDelete, setChatIdToDelete] = useState<string | null>(null)
  const [appearance, setAppearance] = useState(initialAppearance)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false
    try {
      return localStorage.getItem("nibchat.sidebarCollapsed") === "1"
    } catch {
      return false
    }
  })
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
    const id = "nibchat-remote-appearance"
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
      document.getElementById("nibchat-remote-appearance")?.remove()
    }
  }, [])

  function setSidebarCollapsedPersist(next: boolean) {
    setSidebarCollapsed(next)
    try {
      localStorage.setItem("nibchat.sidebarCollapsed", next ? "1" : "0")
    } catch {
      /* ignore */
    }
  }

  const chatsQuery = useQuery({
    ...trpc.workspace.get.queryOptions({ draft: true }),
    initialData: {
      chats: initialChats,
      chat: null,
      nodes: [],
    } satisfies WorkspaceData,
  })

  const providersQuery = useQuery({
    ...trpc.workspace.listProviders.queryOptions(),
    initialData: initialProviders,
  })

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
      setAppearance,
      providers,
      refreshProviders: async () => {
        await queryClient.invalidateQueries(
          trpc.workspace.listProviders.queryFilter()
        )
      },
    }),
    [appearance, providers, queryClient, trpc]
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
            <span className="font-semibold tracking-tight">nibchat</span>
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
                {collapsed ? "n" : "nibchat"}
              </span>
              <TooltipProvider delay={400}>
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
              </TooltipProvider>
            </div>
            {!collapsed ? (
              <>
                <Link
                  href="/chat/new"
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
                      <span className="font-medium">{result.title}</span>
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

          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
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
                      <span className="font-medium">{result.title}</span>
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
                        <span className="truncate">{chat.title}</span>
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
    </ChromeContext.Provider>
  )
}
