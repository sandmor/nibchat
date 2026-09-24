"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { motion } from "motion/react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Cancel01Icon,
  MessageMultiple01Icon,
  Settings01Icon,
  SidebarLeft01Icon,
  SidebarRight01Icon,
} from "@hugeicons/core-free-icons"
import { Button, buttonVariants } from "@/components/ui/button"
import { TooltipProvider, WithTooltip } from "@/components/ui/tooltip"
import {
  Dialog,
  DialogClose,
  DialogContent,
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
import type { ChatRow, SpaceRow } from "@/lib/types"
import type { Appearance, ThemeRecord } from "@/lib/appearance"
import {
  defaultAppearance,
  motionTransition,
  shouldAnimate,
} from "@/lib/appearance"
import type { PromptStackDocument } from "@/lib/prompt-stack"
import { SETTING_LABELS } from "@/lib/chat-settings"
import type { BuiltInToolsPrefs } from "@/lib/agent/tools/catalog"
import {
  isAppearanceDirty,
  useAppearanceStore,
} from "@/lib/appearance-store"
import { activeThemeId } from "@/lib/theme-slot"
import { resolveSpaceAppearance } from "@/lib/spaces/appearance"
import { spaceFromRow } from "@/lib/spaces/tree"
import { useThemeSlot } from "@/components/theme-provider"
import { useTRPC } from "@/lib/trpc-react"
import {
  omitChats,
  omitSpaceSubtree,
  patchChatsSpace,
  type WorkspaceData,
} from "@/lib/workspace-cache"
import type { ProviderSummary } from "./types"
import { AccountMenu } from "./account-menu"
import { BrandMark } from "@/components/logo"
import { AppearanceMagicChrome } from "./appearance-magic"
import { AppearanceRuntime } from "./appearance-runtime"
import {
  useMediaMdUp,
  usePrefersReducedMotion,
  useUserStorageValue,
} from "./hooks"
import { SidebarNav } from "./sidebar-nav"
import {
  parseSpaceSettings,
  spacePolicyImpact,
  spaceSubtreeIds,
} from "@/lib/spaces"
import { WorkspaceSelectionProvider } from "./chat-selection"
import { ChatSelectionBar } from "./chat-selection-bar"
import { ChatSelectToggle } from "./chat-list"
import { WorkspaceDnd } from "./space-dnd"

type ChromeContextValue = {
  appearance: Appearance
  themes: ThemeRecord[]
  lightThemeId: string
  darkThemeId: string
  themeMode: "system" | "light" | "dark"
  activeThemeId: string
  providers: ProviderSummary[]
  isOwner: boolean
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
  chatDefaults: import("@/lib/providers").ModelConfig
  themes: ThemeRecord[]
  lightThemeId: string
  darkThemeId: string
  themeMode: "system" | "light" | "dark"
  defaultPromptStackId: string
  promptStacks: Array<{
    id: string
    name: string
    stack: PromptStackDocument
    created_at: string
    updated_at: string
  }>
  contextBooks: Array<{
    id: string
    name: string
    book: import("@/lib/context-books").ContextBookDocument
    created_at: string
    updated_at: string
  }>
  titleModelConfig: { providerId: string; model: string } | null
  adminTitleSettings: import("@/lib/chat-settings").TitleSettings
  userTitleSettings: import("@/lib/chat-settings").TitleSettings
  builtInTools: BuiltInToolsPrefs
  pdfImagePageLimit: number
}

export function WorkspaceShell({
  initialChats,
  initialSpaces,
  providers: initialProviders,
  initialSettings,
  user,
  isOwner,
  children,
}: {
  initialChats: ChatRow[]
  initialSpaces: SpaceRow[]
  providers: ProviderSummary[]
  initialSettings: InstanceSettings
  user: { id: string; name: string; email: string }
  isOwner: boolean
  children: ReactNode
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const {
    resolved: resolvedSlot,
    mode: themeMode,
    ready: themeReady,
  } = useThemeSlot()
  const [search, setSearch] = useState("")
  const [chatsOpen, setChatsOpen] = useState(false)
  const mdUp = useMediaMdUp()
  const [chatIdsToDelete, setChatIdsToDelete] = useState<string[] | null>(null)
  const [spaceIdToDelete, setSpaceIdToDelete] = useState<string | null>(null)
  const [listStored, setListStored] = useUserStorageValue(
    user.id,
    "nibchat.sidebarList",
    "recents"
  )
  const listMode = listStored === "spaces" ? "spaces" : "recents"
  const [expandedSpaces, setExpandedSpaces] = useState<Set<string>>(
    () => new Set()
  )
  const draftDensity = useAppearanceStore((s) => s.draft?.density)
  const draftMotion = useAppearanceStore((s) => s.draft?.motion)
  const draftMessageActions = useAppearanceStore((s) => s.draft?.messageActions)
  const draftModelPicker = useAppearanceStore((s) => s.draft?.modelPicker)
  const [collapsedStored, setCollapsedStored] = useUserStorageValue(
    user.id,
    "nibchat.sidebarCollapsed",
    "0"
  )
  const sidebarCollapsed = collapsedStored === "1"

  const chatsQuery = useQuery({
    ...trpc.workspace.get.queryOptions({ draft: true }),
    initialData: {
      chats: initialChats,
      spaces: initialSpaces,
      chat: null,
      nodes: [],
      activeGenerations: [],
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
  const lightId =
    settingsQuery.data.lightThemeId || initialSettings.lightThemeId
  const darkId = settingsQuery.data.darkThemeId || initialSettings.darkThemeId
  const chats = chatsQuery.data?.chats ?? initialChats
  const spaces = chatsQuery.data?.spaces ?? initialSpaces
  const routeChatId = pathname.startsWith("/chat/")
    ? pathname.slice("/chat/".length).split("/")[0]
    : null
  const routeSpaceId = pathname.startsWith("/space/")
    ? pathname.slice("/space/".length).split("/")[0]
    : null
  const appearanceSpaceId =
    routeSpaceId ??
    (routeChatId === "new"
      ? searchParams.get("space")
      : chats.find((chat) => chat.id === routeChatId)?.space_id) ??
    null

  const providersQuery = useQuery({
    ...trpc.workspace.listProviders.queryOptions(),
    initialData: initialProviders,
  })

  const persistThemeMode = useMutation(
    trpc.workspace.setThemeMode.mutationOptions()
  )
  const persistedThemeMode = useRef(initialSettings.themeMode)
  useEffect(() => {
    if (!themeReady) return
    if (themeMode === persistedThemeMode.current) return
    persistedThemeMode.current = themeMode
    persistThemeMode.mutate({ themeMode })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeMode, themeReady])

  const currentThemeId = activeThemeId({
    slot: resolvedSlot,
    lightThemeId: lightId,
    darkThemeId: darkId,
  })
  const resolvedAppearance = useMemo(
    () =>
      resolveSpaceAppearance({
        spaceId: appearanceSpaceId,
        spaces: spaces.map(spaceFromRow),
        slot: resolvedSlot,
        userThemeId: currentThemeId,
        themes,
      }),
    [appearanceSpaceId, spaces, resolvedSlot, currentThemeId, themes]
  )
  const activeTheme =
    themes.find((theme) => theme.id === resolvedAppearance.themeId) ?? themes[0]
  const activeAppearance = resolvedAppearance.document ?? defaultAppearance()
  const userThemeDocument =
    themes.find((theme) => theme.id === currentThemeId)?.document ?? null
  const appearanceCustomized = Boolean(
    appearanceSpaceId &&
      (resolvedAppearance.themeId !== currentThemeId ||
        isAppearanceDirty(resolvedAppearance.document, userThemeDocument))
  )
  // Color-only edits retain these nested references, so consumers of chrome do
  // not rerender while the picker is dragged.
  const appearance = useMemo(
    () => ({
      ...activeAppearance,
      density:
        (appearanceCustomized ? undefined : draftDensity) ??
        activeAppearance.density,
      motion:
        (appearanceCustomized ? undefined : draftMotion) ??
        activeAppearance.motion,
      messageActions:
        (appearanceCustomized ? undefined : draftMessageActions) ??
        activeAppearance.messageActions,
      modelPicker:
        (appearanceCustomized ? undefined : draftModelPicker) ??
        activeAppearance.modelPicker,
    }),
    [
      activeAppearance,
      appearanceCustomized,
      draftDensity,
      draftMessageActions,
      draftModelPicker,
      draftMotion,
    ]
  )
  const prefersReduced = usePrefersReducedMotion()
  const animate = shouldAnimate(appearance.motion, prefersReduced)
  const transition = motionTransition(appearance.motion)

  function setSidebarCollapsedPersist(next: boolean) {
    setCollapsedStored(next ? "1" : "0")
  }

  const searchQuery = useQuery({
    ...trpc.workspace.search.queryOptions({ query: search }),
    enabled: search.trim().length > 0,
  })

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`nibchat.spaceExpanded.${user.id}`)
      if (raw != null) {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          setExpandedSpaces(new Set(parsed.map(String)))
        }
        return
      }
      if (spaces.length === 0) return
      setExpandedSpacesPersist(() => new Set(spaces.map((space) => space.id)))
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaces, user.id])
  const spaceById = useMemo(
    () => new Map(spaces.map((space) => [space.id, space])),
    [spaces]
  )
  const deleteSpaceImpact = useMemo(() => {
    if (!spaceIdToDelete) return null
    const target = spaceById.get(spaceIdToDelete)
    if (!target) return null
    const subtree = spaceSubtreeIds(target.id, spaces)
    const settings = parseSpaceSettings(target.settings_json)
    const policies = spacePolicyImpact(settings)
    return {
      chats: chats.filter((chat) => chat.space_id && subtree.has(chat.space_id))
        .length,
      children: [...subtree].filter((id) => id !== target.id).length,
      settings: policies.settings.map((key) => SETTING_LABELS[key]),
      variables: policies.variables,
      books: policies.books,
      rules: policies.rules,
    }
  }, [chats, spaceById, spaceIdToDelete, spaces])
  const results = searchQuery.data ?? []
  const providers = providersQuery.data ?? initialProviders
  const onSettings = pathname.startsWith("/settings")
  const activeChatId = pathname.startsWith("/chat/")
    ? (pathname.slice("/chat/".length).split(/[/?#]/)[0] ?? null)
    : null
  const isDraft = activeChatId === "new"
  const activeSpaceId = pathname.startsWith("/space/")
    ? (pathname.slice("/space/".length).split(/[/?#]/)[0] ?? null)
    : null
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

  useEffect(() => {
    setChatsOpen(false)
  }, [pathname])

  useEffect(() => {
    if (mdUp) setChatsOpen(false)
  }, [mdUp])

  const chromeValue = useMemo(
    () => ({
      appearance,
      themes,
      lightThemeId: lightId,
      darkThemeId: darkId,
      themeMode: settingsQuery.data.themeMode,
      activeThemeId: activeTheme?.id ?? currentThemeId,
      providers,
      isOwner,
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
      settingsQuery.data.themeMode,
      activeTheme?.id,
      currentThemeId,
      providers,
      isOwner,
      queryClient,
      trpc,
    ]
  )

  const deleteChatsMutation = useMutation(
    trpc.workspace.deleteChats.mutationOptions({
      onMutate: async (input) => {
        await queryClient.cancelQueries(trpc.workspace.get.queryFilter())
        const snapshots = queryClient.getQueriesData<WorkspaceData>({
          queryKey: trpc.workspace.get.queryKey(),
        })
        for (const [key, data] of snapshots) {
          queryClient.setQueryData(key, omitChats(data, input.chatIds))
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
        if (activeChatId && input.chatIds.includes(activeChatId)) {
          router.replace("/chat/new")
        }
      },
      onSettled: async () => {
        await queryClient.invalidateQueries(trpc.workspace.get.queryFilter())
        setChatIdsToDelete(null)
      },
    })
  )

  const deleteSpaceMutation = useMutation(
    trpc.workspace.deleteSpace.mutationOptions({
      onMutate: async (input) => {
        await queryClient.cancelQueries(trpc.workspace.get.queryFilter())
        const snapshots = queryClient.getQueriesData<WorkspaceData>({
          queryKey: trpc.workspace.get.queryKey(),
        })
        const subtree = spaceSubtreeIds(input.spaceId, spaces)
        for (const [key, data] of snapshots) {
          queryClient.setQueryData(key, omitSpaceSubtree(data, subtree))
        }
        return { snapshots, subtree }
      },
      onError: (error, _input, context) => {
        if (context?.snapshots) {
          for (const [key, data] of context.snapshots) {
            queryClient.setQueryData(key, data)
          }
        }
        toast.error(error.message || "Could not delete space")
      },
      onSuccess: (result) => {
        const leaveSpace =
          activeSpaceId !== null &&
          result.deletedSpaceIds.includes(activeSpaceId)
        const leaveChat =
          activeChatId !== null && result.deletedChatIds.includes(activeChatId)
        if (leaveSpace || leaveChat) router.replace("/chat/new")
        toast.success("Space deleted")
      },
      onSettled: async () => {
        await queryClient.invalidateQueries(trpc.workspace.get.queryFilter())
        setSpaceIdToDelete(null)
      },
    })
  )
  const createSpaceMutation = useMutation(
    trpc.workspace.createSpace.mutationOptions({
      onSuccess: async (row) => {
        await queryClient.invalidateQueries(trpc.workspace.get.queryFilter())
        setListModePersist("spaces")
        setExpandedSpacesPersist((current) => {
          const next = new Set(current)
          if (row.parent_id) next.add(row.parent_id)
          next.add(row.id)
          return next
        })
        router.push(`/space/${row.id}`)
      },
      onError: (error) =>
        toast.error(error.message || "Could not create space"),
    })
  )
  const setChatsSpaceMutation = useMutation(
    trpc.workspace.setChatsSpace.mutationOptions({
      onMutate: async (input) => {
        await queryClient.cancelQueries(trpc.workspace.get.queryFilter())
        const snapshots = queryClient.getQueriesData<WorkspaceData>({
          queryKey: trpc.workspace.get.queryKey(),
        })
        for (const [key, data] of snapshots) {
          queryClient.setQueryData(
            key,
            patchChatsSpace(data, input.chatIds, input.spaceId)
          )
        }
        if (input.spaceId) {
          setListModePersist("spaces")
          setExpandedSpacesPersist((current) => {
            const next = new Set(current)
            next.add(input.spaceId!)
            return next
          })
        }
        return { snapshots }
      },
      onError: (error, _input, context) => {
        if (context?.snapshots) {
          for (const [key, data] of context.snapshots) {
            queryClient.setQueryData(key, data)
          }
        }
        toast.error(error.message || "Could not move chat")
      },
      onSuccess: (_result, input) => {
        toast.success(
          input.chatIds.length === 1
            ? "Moved"
            : `Moved ${input.chatIds.length} chats`
        )
      },
      onSettled: async () => {
        await queryClient.invalidateQueries(trpc.workspace.get.queryFilter())
      },
    })
  )

  function moveChats(chatIds: string[], spaceId: string | null) {
    if (chatIds.length === 0) return
    setChatsSpaceMutation.mutate({ chatIds, spaceId })
  }

  function setListModePersist(next: "recents" | "spaces") {
    setListStored(next)
  }

  function setExpandedSpacesPersist(
    update: (current: Set<string>) => Set<string>
  ) {
    setExpandedSpaces((current) => {
      const next = update(current)
      try {
        localStorage.setItem(
          `nibchat.spaceExpanded.${user.id}`,
          JSON.stringify([...next])
        )
      } catch {
        /* ignore */
      }
      return next
    })
  }

  function toggleSpace(id: string) {
    setExpandedSpacesPersist((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <ChromeContext.Provider value={chromeValue}>
      <AppearanceRuntime
        themes={themes}
        activeThemeId={resolvedAppearance.themeId}
        fallback={activeAppearance}
        allowLibraryDraft={!appearanceCustomized}
        userId={user.id}
        ready={themeReady}
      />
      <WorkspaceSelectionProvider
        chats={chats}
        animate={animate}
        transition={transition}
        onMoveChats={moveChats}
        onRequestDeleteChats={setChatIdsToDelete}
      >
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
            <TooltipProvider delay={400}>
              <div className="flex items-center gap-1">
                <AccountMenu
                  user={user}
                  isOwner={isOwner}
                  compact
                  menuSide="bottom"
                  menuAlign="end"
                  tooltipSide="bottom"
                />
                <WithTooltip label={onSettings ? "Back to chat" : "Settings"}>
                  <Link
                    href={settingsHref}
                    className={buttonVariants({
                      variant: "ghost",
                      size: "sm",
                    })}
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
            </TooltipProvider>
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
                              onSettings
                                ? MessageMultiple01Icon
                                : Settings01Icon
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
              <WorkspaceDnd id="sidebar-spaces" onMoveChats={moveChats}>
                <SidebarNav
                  chats={chats}
                  spaces={spaces}
                  spaceById={spaceById}
                  search={search}
                  onSearchChange={setSearch}
                  results={results}
                  listMode={listMode}
                  onListMode={setListModePersist}
                  collapsed={collapsed}
                  activeChatId={activeChatId}
                  activeSpaceId={activeSpaceId}
                  isDraft={isDraft}
                  expandedSpaces={expandedSpaces}
                  animate={animate}
                  transition={transition}
                  onToggleSpace={toggleSpace}
                  onDeleteChat={(chatId) => setChatIdsToDelete([chatId])}
                  onDeleteSpace={setSpaceIdToDelete}
                  onCreateSpace={(parentId) =>
                    createSpaceMutation.mutate(parentId ? { parentId } : {})
                  }
                  onCreateChat={(spaceId) =>
                    router.push(`/chat/new?space=${spaceId}`)
                  }
                  onMoveChat={(chatId, spaceId) => moveChats([chatId], spaceId)}
                />
              </WorkspaceDnd>
              <div
                className={cn(
                  "mt-2 shrink-0",
                  collapsed && "flex justify-center"
                )}
              >
                {!collapsed ? (
                  <ChatSelectionBar chats={chats} spaces={spaces} />
                ) : null}
                <div className="border-t pt-2">
                  <TooltipProvider delay={400}>
                    <AccountMenu
                      user={user}
                      isOwner={isOwner}
                      compact={collapsed}
                      tooltipSide="right"
                    />
                  </TooltipProvider>
                </div>
              </div>
            </motion.aside>

            <div
              data-theme-group="app"
              data-theme-target="app-background"
              className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-app-background"
            >
              {children}
            </div>
          </div>

          <Dialog open={chatsOpen && !mdUp} onOpenChange={setChatsOpen}>
            <DialogContent
              showCloseButton={false}
              showOverlay={false}
              className={cn(
                "fixed inset-0 top-0 left-0 z-50 flex h-dvh max-h-dvh w-full max-w-none flex-col",
                "translate-x-0 translate-y-0 gap-0 rounded-none border-0 ring-0",
                "bg-sidebar text-sidebar-foreground sm:max-w-none",
                "overflow-hidden duration-0!",
                "data-open:animate-none data-open:fade-in-0 data-open:zoom-in-100",
                "data-closed:animate-none data-closed:fade-out-0 data-closed:zoom-out-100",
                density === "compact" ? "p-2" : "p-3"
              )}
            >
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
                  <DialogTitle>Chats</DialogTitle>
                  <div className="flex items-center gap-1">
                    {chats.length > 0 ? <ChatSelectToggle icon /> : null}
                    <DialogClose
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Close"
                        />
                      }
                    >
                      <HugeiconsIcon
                        icon={Cancel01Icon}
                        strokeWidth={2}
                        className="size-4"
                      />
                    </DialogClose>
                  </div>
                </div>
                <WorkspaceDnd id="mobile-spaces" onMoveChats={moveChats}>
                  <SidebarNav
                    chats={chats}
                    spaces={spaces}
                    spaceById={spaceById}
                    search={search}
                    onSearchChange={setSearch}
                    results={results}
                    listMode={listMode}
                    onListMode={setListModePersist}
                    activeChatId={activeChatId}
                    activeSpaceId={activeSpaceId}
                    isDraft={isDraft}
                    expandedSpaces={expandedSpaces}
                    animate={animate}
                    transition={transition}
                    onToggleSpace={toggleSpace}
                    onDeleteChat={(chatId) => setChatIdsToDelete([chatId])}
                    onDeleteSpace={setSpaceIdToDelete}
                    onCreateSpace={(parentId) =>
                      createSpaceMutation.mutate(parentId ? { parentId } : {})
                    }
                    onCreateChat={(spaceId) =>
                      router.push(`/chat/new?space=${spaceId}`)
                    }
                    onMoveChat={(chatId, spaceId) =>
                      moveChats([chatId], spaceId)
                    }
                    onNavigate={() => setChatsOpen(false)}
                    showSelect={false}
                  />
                </WorkspaceDnd>
                <div className="shrink-0">
                  <ChatSelectionBar chats={chats} spaces={spaces} />
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <AlertDialog
            open={chatIdsToDelete !== null}
            onOpenChange={(open) => {
              if (!open) setChatIdsToDelete(null)
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {chatIdsToDelete && chatIdsToDelete.length > 1
                    ? `Delete ${chatIdsToDelete.length} conversations?`
                    : "Delete conversation?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {chatIdsToDelete && chatIdsToDelete.length > 1
                    ? "Permanently delete these conversations and every branch. This cannot be undone."
                    : "Permanently delete this conversation and every branch. This cannot be undone."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={async () => {
                    if (!chatIdsToDelete?.length) return
                    await deleteChatsMutation.mutateAsync({
                      chatIds: chatIdsToDelete,
                    })
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog
            open={spaceIdToDelete !== null}
            onOpenChange={(open) => {
              if (!open) setSpaceIdToDelete(null)
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete space?</AlertDialogTitle>
                <AlertDialogDescription>
                  This deletes the space and everything inside. Move chats out
                  first if you want to keep them.
                  {deleteSpaceImpact ? (
                    <DeleteSpaceImpactText impact={deleteSpaceImpact} />
                  ) : null}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={async () => {
                    if (!spaceIdToDelete) return
                    await deleteSpaceMutation.mutateAsync({
                      spaceId: spaceIdToDelete,
                    })
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </WorkspaceSelectionProvider>
      {!appearanceCustomized && <AppearanceMagicChrome />}
    </ChromeContext.Provider>
  )
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function listAnd(items: string[]) {
  if (items.length <= 1) return items[0] ?? ""
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`
}

function DeleteSpaceImpactText({
  impact,
}: {
  impact: {
    chats: number
    children: number
    settings: string[]
    variables: number
    books: number
    rules: number
  }
}) {
  const removing = [
    impact.chats ? countLabel(impact.chats, "chat") : null,
    impact.children ? countLabel(impact.children, "nested space") : null,
  ].filter((item): item is string => Boolean(item))
  const stopping = [
    ...impact.settings,
    impact.variables ? countLabel(impact.variables, "variable policy") : null,
    impact.books ? countLabel(impact.books, "book policy") : null,
    impact.rules ? countLabel(impact.rules, "rule") : null,
  ].filter((item): item is string => Boolean(item))
  if (!removing.length && !stopping.length) return null
  return (
    <span className="mt-2 block">
      {removing.length
        ? `${listAnd(removing)} will be permanently deleted. `
        : null}
      {stopping.length
        ? `${listAnd(stopping)} will be removed with this space.`
        : null}
    </span>
  )
}
