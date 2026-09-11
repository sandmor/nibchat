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
  ArrowRight01Icon,
  Delete02Icon,
  Folder01Icon,
  SquareLock01Icon,
  SquareUnlock01Icon,
} from "@hugeicons/core-free-icons"
import { motionTransition, shouldAnimate } from "@/lib/appearance"
import { siblingSort } from "@/lib/sort-key"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
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
  type SpaceSettings,
} from "@/lib/space"
import { isOrphanPromptStackRef, resolvePromptStack } from "@/lib/prompt-stack"
import { displayChatTitle } from "@/lib/chat-title"
import { cn } from "@/lib/utils"
import { ModelPicker } from "./model-picker"
import { ReasoningPicker } from "./reasoning-picker"
import { StringVariableField } from "./string-variable-field"
import { usePrefersReducedMotion } from "./hooks"
import { useWorkspaceChrome } from "./shell"
import type { SlotMotion } from "./slot-crossfade"
import type { WorkspaceData } from "@/lib/workspace-cache"

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
    return { enabled: false, value: stacks[0]?.id ?? "" }
  }
  if (key === "model") {
    return { enabled: false, value: {} }
  }
  if (key === "reasoning") {
    return { enabled: false, value: {} }
  }
  if (key === "replayReasoning") {
    return { enabled: false, value: true }
  }
  if (key === "stopSequences") {
    return { enabled: false, value: [] }
  }
  if (key === "providerOptions") {
    return { enabled: false, value: {} }
  }
  return { enabled: false, value: 0 }
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
  const workspaceQuery = useQuery({
    ...trpc.workspace.get.queryOptions({ draft: true }),
    initialData: initial,
  })
  const settingsQuery = useQuery(trpc.workspace.getSettings.queryOptions())
  const spaces = workspaceQuery.data?.spaces ?? initial.spaces
  const chats = workspaceQuery.data?.chats ?? initial.chats
  const space = spaces.find((row) => row.id === spaceId) ?? null
  const stacks = settingsQuery.data?.promptStacks ?? []
  const defaultStackId = settingsQuery.data?.defaultPromptStackId ?? null

  const [name, setName] = useState(space?.name ?? "")
  const [description, setDescription] = useState(space?.description ?? "")
  const [settings, setSettings] = useState<SpaceSettings>(() =>
    parseSpaceSettings(space?.settings_json)
  )
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    if (!space) return
    const nextSettings = parseSpaceSettings(space.settings_json)
    setName(space.name)
    setDescription(space.description)
    settingsRef.current = nextSettings
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
      .then(() => updateMut.mutateAsync({ spaceId, ...patch }))
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
                        enabled: true,
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
              <p className="text-xs text-muted-foreground">
                {chatsHere.length === 0
                  ? "None yet"
                  : `${chatsHere.length} here`}
              </p>
            </div>
            {chatsHere.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                New chats from this space land here.
              </p>
            ) : (
              <ul className="grid gap-0.5">
                {chatsHere.map((chat) => (
                  <li key={chat.id}>
                    <Link
                      href={`/chat/${chat.id}`}
                      className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm hover:bg-muted/60"
                    >
                      <span className="min-w-0 truncate font-medium">
                        {displayChatTitle(chat.title)}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {new Date(chat.updated_at).toLocaleDateString()}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="grid gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-medium">Defaults</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Locked values apply to every chat here. Unlock to keep a value
                  without forcing it.
                </p>
              </div>
              {addDefaults}
            </div>

            <div className="grid">
              <AnimatePresence initial={false}>
                {settings.promptStack ? (
                  <RevealItem
                    key="promptStack"
                    itemKey="promptStack"
                    animate={animate}
                    transition={transition}
                  >
                    <DefinitionRow
                      title="Prompt stack"
                      enabled={settings.promptStack.enabled}
                      canEnable={Boolean(settings.promptStack.value)}
                      enableBlockedReason="Choose a prompt stack before locking"
                      onEnabled={(enabled) =>
                        patchSettings((current) => {
                          if (!current.promptStack) return current
                          return {
                            ...current,
                            promptStack: { ...current.promptStack, enabled },
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
                      enabled={settings.model.enabled}
                      canEnable={spaceModelIdentityComplete(
                        settings.model.value
                      )}
                      enableBlockedReason="Choose a provider and model before locking"
                      onEnabled={(enabled) =>
                        patchSettings((current) => {
                          if (!current.model) return current
                          return {
                            ...current,
                            model: { ...current.model, enabled },
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
                      enabled={settings.reasoning.enabled}
                      onEnabled={(enabled) =>
                        patchSettings((current) => {
                          if (!current.reasoning) return current
                          return {
                            ...current,
                            reasoning: { ...current.reasoning, enabled },
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
                        enabled={slot.enabled}
                        onEnabled={(enabled) =>
                          patchSettings((current) => {
                            const currentSlot =
                              current.variables?.[variableName]
                            if (!currentSlot) return current
                            return {
                              ...current,
                              variables: {
                                ...current.variables,
                                [variableName]: { ...currentSlot, enabled },
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
              </AnimatePresence>
            </div>
          </section>
        </div>
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

function DefinitionRow({
  title,
  enabled,
  canEnable = true,
  enableBlockedReason,
  onEnabled,
  onRemove,
  children,
}: {
  title: string
  enabled: boolean
  canEnable?: boolean
  enableBlockedReason?: string
  onEnabled: (enabled: boolean) => void
  onRemove: () => void
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "grid gap-3 rounded-2xl border p-3",
        enabled ? "bg-background/40" : "border-dashed opacity-80"
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-pressed={enabled}
          aria-label={
            enabled ? `Stop applying ${title}` : `Apply ${title} to chats`
          }
          onClick={() => {
            if (!enabled && !canEnable) {
              toast.error(enableBlockedReason ?? "Set a value before locking")
              return
            }
            onEnabled(!enabled)
          }}
        >
          <HugeiconsIcon
            icon={enabled ? SquareLock01Icon : SquareUnlock01Icon}
            strokeWidth={2}
            className="size-4"
          />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-[11px] text-muted-foreground">
            {enabled ? "Locked for chats here" : "Saved, not applying"}
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
      enabled={slot.enabled}
      canEnable={canEnable}
      enableBlockedReason="Max output must be greater than 0 before locking"
      onEnabled={(enabled) => patchSlot({ enabled })}
      onRemove={() => {
        onChange((current) => {
          const next = { ...current }
          delete next[field]
          return next
        })
      }}
    >
      {field === "stopSequences" ? (
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
