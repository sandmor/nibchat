"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  Folder01Icon,
  SquareLock01Icon,
  SquareUnlock01Icon,
} from "@hugeicons/core-free-icons"
import { motionTransition, shouldAnimate } from "@/lib/appearance"
import { siblingSort } from "@/lib/sort-key"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTRPC } from "@/lib/trpc-react"
import {
  SETTING_SLOT_LABELS,
  SPACE_SAMPLING_KEYS,
  definedSettingKeys,
  parseSpaceSettings,
  resolveChatSettings,
  spaceFromRow,
  spaceMaxOutputTokensLockable,
  spaceModelIdentityComplete,
  type SpaceSamplingKey,
  type SpacePolicyMode,
  type SpaceResolutionDecision,
  type SpaceRule,
  type SpaceSettings,
  type SpaceUnresolvedReference,
} from "@/lib/space"
import { isOrphanPromptStackRef, resolvePromptStack } from "@/lib/prompt-stack"
import { displayChatTitle } from "@/lib/chat-title"
import { cn } from "@/lib/utils"
import { ModelPicker } from "./model-picker"
import { ScanDepthField } from "./scan-depth-field"
import {
  inheritedContextBooks,
  SpaceContextBooksCard,
} from "./context-book-picker"
import { DEFAULT_CHAT_CONFIG } from "@/lib/chat-settings"
import { ReasoningPicker } from "./reasoning-picker"
import { StringVariableField } from "./string-variable-field"
import { usePrefersReducedMotion } from "./hooks"
import { useWorkspaceChrome } from "./shell"
import {
  isChatSelectGesture,
  useChatPressSelect,
  useWorkspaceSelection,
} from "./chat-selection"
import { ChatSelectMark, ChatSelectToggle } from "./chat-list"
import { ChatSelectionBar } from "./chat-selection-bar"
import type { SlotMotion } from "./slot-crossfade"
import type { WorkspaceData } from "@/lib/workspace-cache"
import type { ChatRow } from "@/lib/types"

const ADDABLE_KEYS = [
  "promptStack",
  "model",
  "reasoning",
  ...SPACE_SAMPLING_KEYS,
] as const

type AddableKey = (typeof ADDABLE_KEYS)[number]

function defaultSlotValue(
  key: AddableKey,
  stacks: Array<{ id: string }>
): SpaceSettings[AddableKey] {
  if (key === "promptStack") {
    return { mode: "default", value: stacks[0]?.id ?? "" }
  }
  if (key === "model") {
    return { mode: "default", value: {} }
  }
  if (key === "reasoning") {
    return { mode: "default", value: {} }
  }
  if (key === "contextScanDepth")
    return { mode: "default", value: DEFAULT_CHAT_CONFIG.contextScanDepth }
  if (key === "replayReasoning") {
    return { mode: "default", value: true }
  }
  if (key === "stopSequences") {
    return { mode: "default", value: [] }
  }
  if (key === "providerOptions") {
    return { mode: "default", value: {} }
  }
  return { mode: "default", value: 0 }
}

function SpaceChatRow({
  chat,
  orderedIds,
}: {
  chat: ChatRow
  orderedIds: readonly string[]
}) {
  const selection = useWorkspaceSelection()
  const selected = selection.isSelected(chat.id)
  const selecting = selection.selecting
  const press = useChatPressSelect(chat.id, true)
  return (
    <li>
      <Link
        href={`/chat/${chat.id}`}
        aria-selected={selected || undefined}
        onPointerDown={press.onPointerDown}
        onPointerMove={press.onPointerMove}
        onPointerUp={press.onPointerUp}
        onPointerCancel={press.onPointerCancel}
        onContextMenu={press.onContextMenu}
        onClick={(event) => {
          if (press.consumeClick()) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
          if (!selecting && !isChatSelectGesture(event)) return
          event.preventDefault()
          event.stopPropagation()
          selection.selectChat(chat.id, event, orderedIds)
        }}
        className={cn(
          "flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm hover:bg-muted/60",
          selected && "bg-muted ring-1 ring-ring/40"
        )}
      >
        <span className="flex min-w-0 items-center">
          <ChatSelectMark selected={selected} visible={selecting} />
          <span className="min-w-0 truncate font-medium">
            {displayChatTitle(chat.title)}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {new Date(chat.updated_at).toLocaleDateString()}
        </span>
      </Link>
    </li>
  )
}

export function SpaceView({
  spaceId,
  initial,
}: {
  spaceId: string
  initial: WorkspaceData
}) {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { providers, appearance } = useWorkspaceChrome()
  const selection = useWorkspaceSelection()
  const workspaceQuery = useQuery({
    ...trpc.workspace.get.queryOptions({ draft: true }),
    initialData: initial,
  })
  const settingsQuery = useQuery(trpc.workspace.getSettings.queryOptions())
  const spaces = workspaceQuery.data?.spaces ?? initial.spaces
  const chats = workspaceQuery.data?.chats ?? initial.chats
  const space = spaces.find((row) => row.id === spaceId) ?? null
  const stacks = settingsQuery.data?.promptStacks ?? []
  const contextBooks = settingsQuery.data?.contextBooks ?? []
  const defaultStackId = settingsQuery.data?.defaultPromptStackId ?? null

  const [name, setName] = useState(space?.name ?? "")
  const [description, setDescription] = useState(space?.description ?? "")
  const [settings, setSettings] = useState<SpaceSettings>(() =>
    parseSpaceSettings(space?.settings_json)
  )
  const settingsRef = useRef(settings)
  const updatedAtRef = useRef(space?.updated_at)
  settingsRef.current = settings

  useEffect(() => {
    if (!space) return
    const nextSettings = parseSpaceSettings(space.settings_json)
    setName(space.name)
    setDescription(space.description)
    settingsRef.current = nextSettings
    updatedAtRef.current = space.updated_at
    setSettings(nextSettings)
    // Name and settings drafts must survive a settings save (updated_at).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when switching spaces
  }, [space?.id])

  const updateMut = useMutation(
    trpc.workspace.updateSpace.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.workspace.get.queryFilter())
      },
      onError: (error) => toast.error(error.message || "Could not save space"),
    })
  )
  const saveChain = useRef(Promise.resolve<unknown>(undefined))

  function enqueueSave(patch: {
    name?: string
    description?: string
    settings?: SpaceSettings
  }) {
    if (!space) return
    const spaceId = space.id
    saveChain.current = saveChain.current
      .catch(() => undefined)
      .then(async () => {
        const updated = await updateMut.mutateAsync({
          spaceId,
          expectedUpdatedAt: updatedAtRef.current,
          ...patch,
        })
        updatedAtRef.current = updated.updated_at
        return updated
      })
  }
  const createSpaceMut = useMutation(
    trpc.workspace.createSpace.mutationOptions({
      onSuccess: async (row) => {
        await queryClient.invalidateQueries(trpc.workspace.get.queryFilter())
        router.push(`/space/${row.id}`)
      },
      onError: (error) =>
        toast.error(error.message || "Could not create space"),
    })
  )

  function saveMeta() {
    if (!space) return
    enqueueSave({ name, description, settings: settingsRef.current })
  }

  function patchSettings(
    next: SpaceSettings | ((current: SpaceSettings) => SpaceSettings)
  ) {
    const resolved =
      typeof next === "function" ? next(settingsRef.current) : next
    settingsRef.current = resolved
    setSettings(resolved)
    enqueueSave({ settings: resolved })
  }

  function addSlot(key: AddableKey) {
    const slot = defaultSlotValue(key, stacks)
    if (key === "promptStack" && !stacks[0]) {
      toast.error("Create a prompt stack in Settings first")
      return
    }
    patchSettings((current) => ({ ...current, [key]: slot }))
  }

  const defined = definedSettingKeys(settings)
  const available = ADDABLE_KEYS.filter((key) => !defined.includes(key))
  const variableNames = Object.keys(settings.variables ?? {})
  const stackById = useMemo(
    () => new Map(stacks.map((row) => [row.id, row.stack])),
    [stacks]
  )
  const spaceRecords = useMemo(() => spaces.map(spaceFromRow), [spaces])
  const resolvedForSpace = useMemo(
    () =>
      resolveChatSettings({
        chat: {
          spaceId,
          promptStackId: null,
          variables: {},
          model: {},
        },
        spaces: spaceRecords,
      }),
    [spaceId, spaceRecords]
  )
  const effectiveStackId = resolvedForSpace.effective.promptStackId
  const inheritedRules = useMemo(
    () =>
      resolveChatSettings({
        chat: {
          spaceId: space?.parent_id ?? null,
          promptStackId: null,
          variables: {},
          model: {},
        },
        spaces: spaceRecords,
      }).effective.rules,
    [space?.parent_id, spaceRecords]
  )
  const inheritedBooks = inheritedContextBooks(spaceId, spaces, false)
  const resolvedStack = resolvePromptStack({
    chatStackId: effectiveStackId,
    defaultStackId,
    stacksById: stackById,
  })
  const stackVariables = resolvedStack.stack.variables ?? []
  const addableVariables = stackVariables.filter(
    (variable) => !settings.variables?.[variable.name]
  )
  const definedStackId = settings.promptStack?.value
  const stackMissing = isOrphanPromptStackRef(definedStackId, stacks)
  const chatsHere = chats
    .filter((chat) => chat.space_id === spaceId)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
  const chatIdsHere = chatsHere.map((chat) => chat.id)
  const allHereSelected =
    chatIdsHere.length > 0 &&
    chatIdsHere.every((id) => selection.isSelected(id))
  const nestedSpaces = spaces
    .filter((row) => row.parent_id === spaceId)
    .sort(siblingSort)
  const parentSpace = space?.parent_id
    ? (spaces.find((row) => row.id === space.parent_id) ?? null)
    : null
  const hasDefinitions = defined.length > 0 || variableNames.length > 0
  const canAdd = available.length > 0 || addableVariables.length > 0
  const density = appearance.density
  const prefersReduced = usePrefersReducedMotion()
  const animate = shouldAnimate(appearance.motion, prefersReduced)
  const transition = motionTransition(appearance.motion)

  if (!space) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        Space not found.
      </div>
    )
  }

  const addDefaults = canAdd ? (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="outline" size="sm" />}
      >
        <HugeiconsIcon icon={Add01Icon} className="size-4" />
        Add
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {available.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Chat settings</DropdownMenuLabel>
            {available.map((key) => (
              <DropdownMenuItem key={key} onClick={() => addSlot(key)}>
                {SETTING_SLOT_LABELS[key] ?? key}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ) : null}
        {available.length > 0 && addableVariables.length > 0 ? (
          <DropdownMenuSeparator />
        ) : null}
        {addableVariables.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Variables</DropdownMenuLabel>
            {addableVariables.map((variable) => (
              <DropdownMenuItem
                key={variable.name}
                onClick={() =>
                  patchSettings((current) => ({
                    ...current,
                    variables: {
                      ...current.variables,
                      [variable.name]: {
                        mode: "require",
                        value: variable.default,
                      },
                    },
                  }))
                }
              >
                {variable.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <header
        className={cn(
          "flex shrink-0 flex-col gap-3 border-b sm:flex-row sm:items-end sm:justify-between sm:gap-4",
          density === "compact"
            ? "px-3 py-3 sm:px-4"
            : "px-4 py-4 sm:px-5 sm:py-5"
        )}
      >
        <div className="min-w-0 flex-1">
          {parentSpace ? (
            <Link
              href={`/space/${parentSpace.id}`}
              className="mb-1 inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <span className="truncate">{parentSpace.name}</span>
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                strokeWidth={2}
                className="size-3 shrink-0"
              />
            </Link>
          ) : (
            <p className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Space
            </p>
          )}
          <input
            aria-label="Space name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={saveMeta}
            className="w-full bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground"
            placeholder="Space name"
          />
          <textarea
            aria-label="Description"
            value={description}
            rows={1}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={saveMeta}
            placeholder="What belongs here?"
            className="mt-1 field-sizing-content max-h-24 w-full resize-none bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/80"
          />
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => router.push(`/chat/new?space=${space.id}`)}
          >
            <HugeiconsIcon icon={Add01Icon} className="size-4" />
            New chat
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => createSpaceMut.mutate({ parentId: space.id })}
          >
            New subspace
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-3xl gap-8 p-5 sm:p-8">
          {nestedSpaces.length > 0 ? (
            <section className="grid gap-2">
              <h2 className="text-sm font-medium">Spaces inside</h2>
              <ul className="grid gap-0.5">
                {nestedSpaces.map((child) => (
                  <li key={child.id}>
                    <Link
                      href={`/space/${child.id}`}
                      className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-muted/60"
                    >
                      <HugeiconsIcon
                        icon={Folder01Icon}
                        strokeWidth={2}
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 truncate font-medium">
                        {child.name}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="grid gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-medium">Chats</h2>
              <div className="flex items-center gap-2">
                {chatsHere.length > 0 ? (
                  <>
                    <ChatSelectToggle size="xs" />
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        allHereSelected
                          ? selection.clearSelection()
                          : selection.setSelectedIds(chatIdsHere)
                      }
                    >
                      {allHereSelected ? "Clear" : "Select all"}
                    </Button>
                  </>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {chatsHere.length === 0
                    ? "None yet"
                    : `${chatsHere.length} here`}
                </p>
              </div>
            </div>
            {chatsHere.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                New chats from this space land here.
              </p>
            ) : (
              <ul className="grid gap-0.5">
                {chatsHere.map((chat) => (
                  <SpaceChatRow
                    key={chat.id}
                    chat={chat}
                    orderedIds={chatIdsHere}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="grid gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-medium">Defaults</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Values here apply to chats in this space. Require one to lock
                  it, or release a parent value. Books and rules add to parent
                  spaces unless you exclude them.
                </p>
              </div>
              {addDefaults}
            </div>

            <div className="grid">
              <AnimatePresence initial={false}>
                <RevealItem
                  key="contextBooks"
                  itemKey="contextBooks"
                  animate={animate}
                  transition={transition}
                >
                  <SpaceContextBooksCard
                    books={contextBooks}
                    attachedIds={Object.entries(
                      settings.books?.decisions ?? {}
                    ).flatMap(([id, decision]) =>
                      decision === "include" ? [id] : []
                    )}
                    inherited={
                      settings.books?.reset ? new Map() : inheritedBooks
                    }
                    reset={settings.books?.reset ?? false}
                    excludedIds={Object.entries(
                      settings.books?.decisions ?? {}
                    ).flatMap(([id, decision]) =>
                      decision === "exclude" ? [id] : []
                    )}
                    entryDecisions={settings.books?.entries ?? {}}
                    onChange={(nextBooks) =>
                      patchSettings((current) => ({
                        ...current,
                        books: {
                          reset: current.books?.reset ?? false,
                          decisions: {
                            ...Object.fromEntries(
                              Object.entries(
                                current.books?.decisions ?? {}
                              ).filter(([, decision]) => decision === "exclude")
                            ),
                            ...Object.fromEntries(
                              nextBooks.map((id) => [id, "include" as const])
                            ),
                          },
                          entries: current.books?.entries,
                        },
                      }))
                    }
                    onExclude={(id, excluded) =>
                      patchSettings((current) => {
                        const decisions = {
                          ...current.books?.decisions,
                        }
                        if (excluded) decisions[id] = "exclude"
                        else delete decisions[id]
                        return {
                          ...current,
                          books: {
                            reset: current.books?.reset ?? false,
                            decisions,
                            entries: current.books?.entries,
                          },
                        }
                      })
                    }
                    onReset={(reset) =>
                      patchSettings((current) => ({
                        ...current,
                        books: {
                          reset,
                          decisions: current.books?.decisions ?? {},
                          entries: current.books?.entries,
                        },
                      }))
                    }
                    onEntryChange={(entries) =>
                      patchSettings((current) => ({
                        ...current,
                        books: {
                          reset: current.books?.reset ?? false,
                          decisions: current.books?.decisions ?? {},
                          entries,
                        },
                      }))
                    }
                  />
                </RevealItem>
                <RevealItem
                  key="rules"
                  itemKey="rules"
                  animate={animate}
                  transition={transition}
                >
                  <SpaceRulesCard
                    inherited={inheritedRules}
                    local={settings.rules ?? []}
                    unresolved={resolvedForSpace.unresolved.filter(
                      (item) => item.source.spaceId === spaceId
                    )}
                    onChange={(rules) =>
                      patchSettings((current) => ({ ...current, rules }))
                    }
                  />
                </RevealItem>
                {settings.promptStack ? (
                  <RevealItem
                    key="promptStack"
                    itemKey="promptStack"
                    animate={animate}
                    transition={transition}
                  >
                    <DefinitionRow
                      title="Prompt stack"
                      mode={settings.promptStack.mode}
                      canEnable={Boolean(settings.promptStack.value)}
                      enableBlockedReason="Choose a prompt stack before requiring"
                      onMode={(mode) =>
                        patchSettings((current) => {
                          if (!current.promptStack) return current
                          return {
                            ...current,
                            promptStack: { ...current.promptStack, mode },
                          }
                        })
                      }
                      onRemove={() => {
                        patchSettings((current) => {
                          const next = { ...current }
                          delete next.promptStack
                          return next
                        })
                      }}
                    >
                      {stackMissing ? (
                        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                          This stack was removed. Generations fall back to the
                          instance default until you pick another.
                        </p>
                      ) : null}
                      <Select
                        value={settings.promptStack.value}
                        items={Object.fromEntries(
                          stacks.map((s) => [s.id, s.name])
                        )}
                        onValueChange={(value) => {
                          if (value == null) return
                          patchSettings((current) => {
                            if (!current.promptStack) return current
                            return {
                              ...current,
                              promptStack: {
                                ...current.promptStack,
                                value: String(value),
                              },
                            }
                          })
                        }}
                      >
                        <SelectTrigger className="w-full max-w-xs">
                          <SelectValue placeholder="Choose a stack" />
                        </SelectTrigger>
                        <SelectContent>
                          {stacks.map((stack) => (
                            <SelectItem key={stack.id} value={stack.id}>
                              {stack.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </DefinitionRow>
                  </RevealItem>
                ) : null}

                {settings.model ? (
                  <RevealItem
                    key="model"
                    itemKey="model"
                    animate={animate}
                    transition={transition}
                  >
                    <DefinitionRow
                      title="Model"
                      mode={settings.model.mode}
                      canEnable={spaceModelIdentityComplete(
                        settings.model.value
                      )}
                      enableBlockedReason="Choose a provider and model before requiring"
                      onMode={(mode) =>
                        patchSettings((current) => {
                          if (!current.model) return current
                          return {
                            ...current,
                            model: { ...current.model, mode },
                          }
                        })
                      }
                      onRemove={() => {
                        patchSettings((current) => {
                          const next = { ...current }
                          delete next.model
                          return next
                        })
                      }}
                    >
                      <ModelPicker
                        config={settings.model.value}
                        providers={providers}
                        showIds={appearance.modelPicker.showIds}
                        onChange={(config) =>
                          patchSettings((current) => {
                            if (!current.model) return current
                            return {
                              ...current,
                              model: {
                                ...current.model,
                                value: {
                                  providerId: config.providerId,
                                  model: config.model,
                                },
                              },
                            }
                          })
                        }
                      />
                    </DefinitionRow>
                  </RevealItem>
                ) : null}

                {settings.reasoning ? (
                  <RevealItem
                    key="reasoning"
                    itemKey="reasoning"
                    animate={animate}
                    transition={transition}
                  >
                    <DefinitionRow
                      title="Reasoning"
                      mode={settings.reasoning.mode}
                      onMode={(mode) =>
                        patchSettings((current) => {
                          if (!current.reasoning) return current
                          return {
                            ...current,
                            reasoning: { ...current.reasoning, mode },
                          }
                        })
                      }
                      onRemove={() => {
                        patchSettings((current) => {
                          const next = { ...current }
                          delete next.reasoning
                          return next
                        })
                      }}
                    >
                      <ReasoningPicker
                        config={{
                          ...settings.model?.value,
                          reasoning: settings.reasoning.value,
                        }}
                        providers={providers}
                        onChange={(config) =>
                          patchSettings((current) => {
                            if (!current.reasoning) return current
                            return {
                              ...current,
                              reasoning: {
                                ...current.reasoning,
                                value: config.reasoning ?? {},
                              },
                            }
                          })
                        }
                        onEditParameters={() => undefined}
                      />
                    </DefinitionRow>
                  </RevealItem>
                ) : null}

                {SPACE_SAMPLING_KEYS.filter((key) => settings[key]).map(
                  (key) => (
                    <RevealItem
                      key={key}
                      itemKey={key}
                      animate={animate}
                      transition={transition}
                    >
                      <SamplingDefinition
                        field={key}
                        settings={settings}
                        onChange={patchSettings}
                      />
                    </RevealItem>
                  )
                )}

                {variableNames.map((variableName) => {
                  const slot = settings.variables?.[variableName]
                  if (!slot) return null
                  const declared = stackVariables.find(
                    (item) => item.name === variableName
                  )
                  return (
                    <RevealItem
                      key={`var-${variableName}`}
                      itemKey={`var-${variableName}`}
                      animate={animate}
                      transition={transition}
                    >
                      <DefinitionRow
                        title={variableName}
                        mode={slot.mode}
                        onMode={(mode) =>
                          patchSettings((current) => {
                            const currentSlot =
                              current.variables?.[variableName]
                            if (!currentSlot) return current
                            return {
                              ...current,
                              variables: {
                                ...current.variables,
                                [variableName]: { ...currentSlot, mode },
                              },
                            }
                          })
                        }
                        onRemove={() => {
                          patchSettings((current) => {
                            const variables = { ...current.variables }
                            delete variables[variableName]
                            return { ...current, variables }
                          })
                        }}
                      >
                        {declared?.type === "boolean" ||
                        typeof slot.value === "boolean" ? (
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={Boolean(slot.value)}
                              onCheckedChange={(checked) =>
                                patchSettings((current) => {
                                  const currentSlot =
                                    current.variables?.[variableName]
                                  if (!currentSlot) return current
                                  return {
                                    ...current,
                                    variables: {
                                      ...current.variables,
                                      [variableName]: {
                                        ...currentSlot,
                                        value: checked,
                                      },
                                    },
                                  }
                                })
                              }
                            />
                            <span className="text-sm text-muted-foreground">
                              {slot.value ? "On" : "Off"}
                            </span>
                          </div>
                        ) : (
                          <SpaceStringVariableField
                            name={variableName}
                            value={String(slot.value ?? "")}
                            onCommit={(value) =>
                              patchSettings((current) => {
                                const currentSlot =
                                  current.variables?.[variableName]
                                if (!currentSlot) return current
                                return {
                                  ...current,
                                  variables: {
                                    ...current.variables,
                                    [variableName]: { ...currentSlot, value },
                                  },
                                }
                              })
                            }
                          />
                        )}
                      </DefinitionRow>
                    </RevealItem>
                  )
                })}
                {!hasDefinitions ? (
                  <RevealItem
                    key="empty-defaults"
                    itemKey="empty-defaults"
                    animate={animate}
                    transition={transition}
                  >
                    <p className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
                      Chats keep their own model, stack, and variables until you
                      add a default.
                    </p>
                  </RevealItem>
                ) : null}
                {resolvedForSpace.decisions.length ||
                resolvedForSpace.unresolved.length ? (
                  <RevealItem
                    key="policyTrace"
                    itemKey="policyTrace"
                    animate={animate}
                    transition={transition}
                  >
                    <PolicyResolutionTrace
                      books={contextBooks}
                      rules={[
                        ...inheritedRules,
                        ...(settings.rules ?? []).flatMap((rule) =>
                          rule.title ? [{ id: rule.id, title: rule.title }] : []
                        ),
                      ]}
                      decisions={resolvedForSpace.decisions}
                      unresolved={resolvedForSpace.unresolved}
                    />
                  </RevealItem>
                ) : null}
              </AnimatePresence>
            </div>
          </section>
        </div>
      </div>
      <div className="md:hidden">
        <ChatSelectionBar chats={chats} spaces={spaces} />
      </div>
    </section>
  )
}

function RevealItem({
  itemKey,
  animate,
  transition,
  children,
}: {
  itemKey: string
  animate: boolean
  transition: SlotMotion
  children: ReactNode
}) {
  return (
    <motion.div
      key={itemKey}
      initial={animate ? { height: 0, opacity: 0 } : false}
      animate={{ height: "auto", opacity: 1 }}
      exit={animate ? { height: 0, opacity: 0 } : { height: 0 }}
      transition={transition}
      className="overflow-hidden"
    >
      <div className="pb-2">{children}</div>
    </motion.div>
  )
}

const POLICY_ACTION_LABELS: Record<string, string> = {
  default: "default",
  require: "required",
  release: "released",
  include: "included",
  exclude: "excluded",
  reset: "cleared parent books",
  disable: "disabled",
  restore: "restored",
  define: "added",
  replace: "replaced",
}

function decisionLabel(
  decision: SpaceResolutionDecision,
  books: Array<{
    id: string
    name: string
    book?: { entries: Array<{ id: string; title: string }> }
  }>,
  ruleTitles: Map<string, string>
) {
  if (decision.kind === "setting") {
    const name = decision.key.startsWith("variable:")
      ? decision.key.slice("variable:".length)
      : (SETTING_SLOT_LABELS[decision.key] ?? decision.key)
    return `${name} · ${POLICY_ACTION_LABELS[decision.action] ?? decision.action}`
  }
  if (decision.kind === "book") {
    if (decision.key === "*") return "Ignore parent books"
    const name =
      books.find((book) => book.id === decision.key)?.name ?? "Missing book"
    return `${name} · ${POLICY_ACTION_LABELS[decision.action] ?? decision.action}`
  }
  if (decision.kind === "entry") {
    const [bookId, entryId] = decision.key.split(":")
    const book = books.find((item) => item.id === bookId)
    const title =
      book?.book?.entries.find((entry) => entry.id === entryId)?.title ??
      "Entry"
    return `${title} · ${POLICY_ACTION_LABELS[decision.action] ?? decision.action}`
  }
  const title = ruleTitles.get(decision.key) ?? "Rule"
  return `${title} · ${POLICY_ACTION_LABELS[decision.action] ?? decision.action}`
}

function PolicyResolutionTrace({
  books,
  rules,
  decisions,
  unresolved,
}: {
  books: Array<{
    id: string
    name: string
    book?: { entries: Array<{ id: string; title: string }> }
  }>
  rules: Array<{ id: string; title: string }>
  decisions: SpaceResolutionDecision[]
  unresolved: SpaceUnresolvedReference[]
}) {
  const ruleTitles = useMemo(
    () => new Map(rules.map((rule) => [rule.id, rule.title])),
    [rules]
  )
  if (!decisions.length && !unresolved.length) return null
  return (
    <Collapsible className="group/applied space-y-1 px-1">
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
        Applied here
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="size-3.5 shrink-0 transition-transform group-data-open/applied:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mb-2 text-[11px] text-muted-foreground">
          From the root space toward this one. Later values win.
        </p>
        <ol className="grid gap-1">
          {decisions.map((decision, index) => (
            <li
              key={`${decision.source.spaceId}:${decision.kind}:${decision.key}:${index}`}
              className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-lg px-2.5 py-1.5 text-xs hover:bg-muted/60"
            >
              <span className="font-medium">
                {decisionLabel(decision, books, ruleTitles)}
              </span>
              <span className="text-muted-foreground">
                {decision.source.spaceName}
              </span>
            </li>
          ))}
        </ol>
        {unresolved.length ? (
          <p className="mt-2 text-xs text-destructive">
            {unresolved.length === 1
              ? "1 rule points at a parent that is no longer there."
              : `${unresolved.length} rules point at parents that are no longer there.`}
          </p>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  )
}

function RuleDraftFields({
  title,
  content,
  titleLabel,
  contentLabel,
  onCommit,
}: {
  title: string
  content: string
  titleLabel: string
  contentLabel: string
  onCommit: (next: { title: string; content: string }) => void
}) {
  const [titleText, setTitleText] = useState(title)
  const [contentText, setContentText] = useState(content)
  useEffect(() => {
    setTitleText(title)
  }, [title])
  useEffect(() => {
    setContentText(content)
  }, [content])

  function commit() {
    if (titleText === title && contentText === content) return
    onCommit({ title: titleText, content: contentText })
  }

  return (
    <div className="grid gap-2">
      <Input
        value={titleText}
        aria-label={titleLabel}
        onChange={(event) => setTitleText(event.target.value)}
        onBlur={commit}
      />
      <Textarea
        rows={4}
        value={contentText}
        aria-label={contentLabel}
        onChange={(event) => setContentText(event.target.value)}
        onBlur={commit}
      />
    </div>
  )
}

function SpaceRulesCard({
  inherited,
  local,
  unresolved,
  onChange,
}: {
  inherited: Array<{
    id: string
    title: string
    content: string
    source: { spaceName: string }
  }>
  local: SpaceRule[]
  unresolved: Array<{ id: string; operation: string }>
  onChange: (rules: SpaceRule[]) => void
}) {
  const inheritedIds = new Set(inherited.map((rule) => rule.id))

  function update(index: number, patch: Partial<SpaceRule>) {
    onChange(
      local.map((rule, i) => (i === index ? { ...rule, ...patch } : rule))
    )
  }

  function exceptionFor(id: string) {
    return local.findIndex((rule) => rule.id === id)
  }

  function setException(rule: SpaceRule, index: number) {
    if (index >= 0) update(index, rule)
    else onChange([...local, rule])
  }

  return (
    <div className="grid gap-3 rounded-2xl border bg-background/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Rules</p>
          <p className="text-[11px] text-muted-foreground">
            Instructions for chats here. Child spaces inherit them unless you
            replace or disable one.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([
              ...local,
              {
                id: crypto.randomUUID(),
                operation: "define",
                title: "New rule",
                content: "",
              },
            ])
          }
        >
          <HugeiconsIcon icon={Add01Icon} className="size-4" />
          Add rule
        </Button>
      </div>
      {unresolved.length ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {unresolved.map((item) => (
            <p key={`${item.id}:${item.operation}`}>
              {item.operation} targets a rule that is no longer inherited
            </p>
          ))}
        </div>
      ) : null}

      {inherited.map((rule) => {
        const index = exceptionFor(rule.id)
        const exception = index >= 0 ? local[index] : undefined
        const replacing = exception?.operation === "replace"
        return (
          <div
            key={rule.id}
            className={cn(
              "grid gap-2 rounded-xl border p-3",
              exception?.operation === "disable" && "border-dashed opacity-80"
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {replacing ? (exception.title ?? rule.title) : rule.title}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  From {rule.source.spaceName}
                  {exception
                    ? ` · ${POLICY_ACTION_LABELS[exception.operation] ?? exception.operation} here`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-pressed={replacing}
                  onClick={() =>
                    setException(
                      {
                        id: rule.id,
                        operation: "replace",
                        title: exception?.title ?? rule.title,
                        content: exception?.content ?? rule.content,
                      },
                      index
                    )
                  }
                >
                  Replace
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-pressed={
                    exception?.operation === "disable" ||
                    exception?.operation === "restore"
                  }
                  onClick={() =>
                    setException(
                      {
                        id: rule.id,
                        operation:
                          exception?.operation === "disable"
                            ? "restore"
                            : "disable",
                      },
                      index
                    )
                  }
                >
                  {exception?.operation === "disable" ? "Restore" : "Disable"}
                </Button>
                {exception ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Remove local exception for ${rule.title}`}
                    onClick={() =>
                      onChange(local.filter((_, i) => i !== index))
                    }
                  >
                    <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                  </Button>
                ) : null}
              </div>
            </div>
            {replacing ? (
              <RuleDraftFields
                title={exception.title ?? rule.title}
                content={exception.content ?? rule.content}
                titleLabel="Rule title"
                contentLabel={`${exception.title ?? rule.title} content`}
                onCommit={(next) => update(index, next)}
              />
            ) : (
              <p className="line-clamp-3 text-xs text-muted-foreground">
                {rule.content.trim() || "Empty rule"}
              </p>
            )}
          </div>
        )
      })}

      {local.map((rule, index) => {
        if (rule.operation === "disable" || rule.operation === "restore")
          return null
        if (rule.operation === "replace" && inheritedIds.has(rule.id))
          return null
        return (
          <div
            key={`${rule.id}-${index}`}
            className="grid gap-2 rounded-xl border p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="pt-1 text-[11px] text-muted-foreground">
                Added here
              </p>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive"
                aria-label="Remove rule"
                onClick={() => onChange(local.filter((_, i) => i !== index))}
              >
                <HugeiconsIcon icon={Delete02Icon} className="size-4" />
              </Button>
            </div>
            <RuleDraftFields
              title={rule.title ?? ""}
              content={rule.content ?? ""}
              titleLabel="Rule title"
              contentLabel={`${rule.title ?? "Rule"} content`}
              onCommit={(next) => update(index, next)}
            />
          </div>
        )
      })}

      {!inherited.length && !local.length ? (
        <p className="text-sm text-muted-foreground">None yet.</p>
      ) : null}
    </div>
  )
}

function DefinitionRow({
  title,
  mode,
  canEnable = true,
  enableBlockedReason,
  onMode,
  onRemove,
  children,
}: {
  title: string
  mode: SpacePolicyMode
  canEnable?: boolean
  enableBlockedReason?: string
  onMode: (mode: SpacePolicyMode) => void
  onRemove: () => void
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "grid gap-3 rounded-2xl border bg-background/40 p-3",
        mode === "release" && "border-dashed opacity-80"
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <HugeiconsIcon
          icon={mode === "require" ? SquareLock01Icon : SquareUnlock01Icon}
          strokeWidth={2}
          className="ms-2 size-4 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-[11px] text-muted-foreground">
            {mode === "require"
              ? "Required for chats here"
              : mode === "default"
                ? "Default; chats may override it"
                : "Stops applying the parent value here"}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          aria-label={`Remove ${title}`}
          onClick={onRemove}
        >
          <HugeiconsIcon icon={Delete02Icon} className="size-4" />
        </Button>
      </div>
      <div role="group" aria-label={`${title} policy`} className="ms-10">
        <ToggleGroup
          value={[mode]}
          onValueChange={(value) => {
            const next = value[0]
            if (next !== "default" && next !== "require" && next !== "release")
              return
            if (next !== "release" && !canEnable) {
              toast.error(enableBlockedReason ?? "Set a value before applying")
              return
            }
            onMode(next)
          }}
          variant="outline"
          size="sm"
          spacing={0}
        >
          <ToggleGroupItem value="default">Default</ToggleGroupItem>
          <ToggleGroupItem value="require">Require</ToggleGroupItem>
          <ToggleGroupItem value="release">Release</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="min-w-0 ps-10">{children}</div>
    </div>
  )
}

function SamplingDefinition({
  field,
  settings,
  onChange,
}: {
  field: SpaceSamplingKey
  settings: SpaceSettings
  onChange: (patch: (current: SpaceSettings) => SpaceSettings) => void
}) {
  const slot = settings[field]
  if (!slot) return null
  const canEnable =
    field !== "maxOutputTokens" ||
    spaceMaxOutputTokensLockable(Number(slot.value))

  function patchSlot(update: Record<string, unknown>) {
    onChange((current) => {
      const currentSlot = current[field]
      if (!currentSlot) return current
      return { ...current, [field]: { ...currentSlot, ...update } }
    })
  }

  return (
    <DefinitionRow
      title={SETTING_SLOT_LABELS[field] ?? field}
      mode={slot.mode}
      canEnable={canEnable}
      enableBlockedReason="Max output must be greater than 0 before requiring"
      onMode={(mode) => patchSlot({ mode })}
      onRemove={() => {
        onChange((current) => {
          const next = { ...current }
          delete next[field]
          return next
        })
      }}
    >
      {field === "contextScanDepth" ? (
        <ScanDepthField
          value={slot.value as number | null}
          onChange={(value) => patchSlot({ value })}
        />
      ) : field === "stopSequences" ? (
        <StopSequencesField
          value={slot.value as string[]}
          onCommit={(value) => patchSlot({ value })}
        />
      ) : field === "providerOptions" ? (
        <ProviderOptionsField
          value={(slot.value as Record<string, unknown>) ?? {}}
          onCommit={(value) => patchSlot({ value })}
        />
      ) : field === "replayReasoning" ? (
        <Switch
          checked={Boolean(slot.value)}
          onCheckedChange={(checked) => patchSlot({ value: checked })}
        />
      ) : (
        <SamplingNumberField
          label={SETTING_SLOT_LABELS[field] ?? field}
          value={typeof slot.value === "number" ? slot.value : 0}
          onCommit={(value) => patchSlot({ value })}
        />
      )}
    </DefinitionRow>
  )
}

function ProviderOptionsField({
  value,
  onCommit,
}: {
  value: Record<string, unknown>
  onCommit: (value: Record<string, unknown>) => void
}) {
  const committed = JSON.stringify(value ?? {}, null, 2)
  const [text, setText] = useState(committed)
  useEffect(() => {
    setText(committed)
  }, [committed])

  function commit() {
    try {
      const parsed: unknown = JSON.parse(text)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Expected a JSON object")
      }
      const next = parsed as Record<string, unknown>
      if (JSON.stringify(next) === JSON.stringify(value ?? {})) return
      onCommit(next)
    } catch {
      toast.error("Provider JSON is invalid")
      setText(committed)
    }
  }

  return (
    <Textarea
      className="font-mono text-xs"
      rows={4}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      aria-label="Provider-specific JSON"
    />
  )
}

function SpaceStringVariableField({
  name,
  value,
  onCommit,
}: {
  name: string
  value: string
  onCommit: (value: string) => void
}) {
  const [text, setText] = useState(value)
  useEffect(() => {
    setText(value)
  }, [value])

  function commit() {
    if (text === value) return
    onCommit(text)
  }

  return (
    <StringVariableField
      ariaLabel={name}
      compact
      value={text}
      onChange={setText}
      onBlur={commit}
    />
  )
}

function SamplingNumberField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: number
  onCommit: (value: number) => void
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => {
    setText(String(value))
  }, [value])

  function commit() {
    const next = Number(text)
    if (text.trim() === "" || !Number.isFinite(next)) {
      setText(String(value))
      return
    }
    if (next === value) return
    onCommit(next)
  }

  return (
    <Input
      type="number"
      aria-label={label}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function StopSequencesField({
  value,
  onCommit,
}: {
  value: string[]
  onCommit: (value: string[]) => void
}) {
  const committed = value.join(", ")
  const [text, setText] = useState(committed)
  useEffect(() => {
    setText(committed)
  }, [committed])

  function commit() {
    const next = text
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
    if (next.join(", ") === committed) return
    onCommit(next)
  }

  return (
    <Input
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur()
        }
      }}
    />
  )
}
