"use client"

import { useMemo, useState } from "react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Delete02Icon, DragDropVerticalIcon } from "@hugeicons/core-free-icons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/lib/trpc-react"
import {
  createEmptyModule,
  defaultPromptStack,
  findSystemAfterNonSystemWarnings,
  placementLabel,
  type ModulePlacement,
  type PromptModule,
  type PromptStackDocument,
  type StackModule,
} from "@/lib/prompt-stack"

const PLACEMENTS: ModulePlacement[] = ["relative", "in_chat"]

const PLACEMENT_ITEMS = {
  relative: "Relative",
  in_chat: "In chat",
} as const

const ROLE_ITEMS = {
  system: "system",
  user: "user",
  assistant: "assistant",
} as const

export function PromptStackSettings() {
  const trpc = useTRPC()
  const settingsQuery = useQuery(trpc.workspace.getSettings.queryOptions())
  const stacks = settingsQuery.data?.promptStacks ?? []
  const defaultId = settingsQuery.data?.defaultPromptStackId ?? null

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const effectiveId = selectedId ?? defaultId ?? stacks[0]?.id ?? null
  const selected = stacks.find((s) => s.id === effectiveId) ?? null

  const [draft, setDraft] = useState<{
    stackId: string
    name: string
    modules: StackModule[]
  } | null>(null)
  const activeDraft =
    draft && selected && draft.stackId === selected.id ? draft : null
  const modules = activeDraft?.modules ?? selected?.stack.modules ?? []
  const name = activeDraft?.name ?? selected?.name ?? ""

  const warningIds = useMemo(() => {
    return new Set(
      findSystemAfterNonSystemWarnings({ modules }, []).map((w) => w.moduleId)
    )
  }, [modules])

  const dirty = Boolean(
    selected &&
    activeDraft &&
    (activeDraft.name !== selected.name ||
      JSON.stringify(activeDraft.modules) !==
        JSON.stringify(selected.stack.modules))
  )

  const refetch = async () => {
    await settingsQuery.refetch()
  }

  function ensureDraft(base = selected) {
    if (!base) return null
    if (draft?.stackId === base.id) return draft
    const next = {
      stackId: base.id,
      name: base.name,
      modules: base.stack.modules.map((m) => ({ ...m })),
    }
    setDraft(next)
    return next
  }

  function setModules(next: StackModule[]) {
    if (!selected) return
    const d = ensureDraft(selected)
    if (!d) return
    setDraft({ ...d, modules: next })
  }

  function setName(next: string) {
    if (!selected) return
    const d = ensureDraft(selected)
    if (!d) return
    setDraft({ ...d, name: next })
  }

  const createMut = useMutation(
    trpc.workspace.createPromptStack.mutationOptions({
      onSuccess: async (created) => {
        toast.success("Stack created")
        await refetch()
        setSelectedId(created.id)
        setDraft(null)
      },
      onError: (e) => toast.error(e.message || "Could not create"),
    })
  )
  const updateMut = useMutation(
    trpc.workspace.updatePromptStack.mutationOptions({
      onSuccess: async () => {
        toast.success("Stack saved")
        setDraft(null)
        await refetch()
      },
      onError: (e) => toast.error(e.message || "Could not save"),
    })
  )
  const duplicateMut = useMutation(
    trpc.workspace.duplicatePromptStack.mutationOptions({
      onSuccess: async (created) => {
        toast.success("Stack duplicated")
        await refetch()
        setSelectedId(created.id)
        setDraft(null)
      },
      onError: (e) => toast.error(e.message || "Could not duplicate"),
    })
  )
  const deleteMut = useMutation(
    trpc.workspace.deletePromptStack.mutationOptions({
      onSuccess: async () => {
        toast.success("Stack deleted")
        setSelectedId(null)
        setDraft(null)
        await refetch()
      },
      onError: (e) => toast.error(e.message || "Could not delete"),
    })
  )
  const setDefaultMut = useMutation(
    trpc.workspace.setInstanceDefaultPromptStack.mutationOptions({
      onSuccess: async () => {
        toast.success("Instance default updated")
        await refetch()
      },
      onError: (e) => toast.error(e.message || "Could not set default"),
    })
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = modules.findIndex((m) => m.id === active.id)
    const newIndex = modules.findIndex((m) => m.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    setModules(arrayMove(modules, oldIndex, newIndex))
  }

  function updatePromptModule(id: string, patch: Partial<PromptModule>) {
    setModules(
      modules.map((m) => {
        if (m.id !== id || m.kind !== "prompt") return m
        const next: PromptModule = { ...m, ...patch }
        if (next.placement === "in_chat" && next.depth === undefined) {
          next.depth = 0
        }
        if (next.placement === "relative") {
          delete next.depth
        }
        if (!next.role) next.role = "system"
        return next
      })
    )
  }

  function updateHistoryEnabled(id: string, enabled: boolean) {
    setModules(
      modules.map((m) =>
        m.id === id && m.kind === "history" ? { ...m, enabled } : m
      )
    )
  }

  function save() {
    if (!selected) return
    const stack: PromptStackDocument = { modules }
    updateMut.mutate({
      id: selected.id,
      name,
      stack,
    })
  }

  const isDefault = selected && defaultId === selected.id
  const loaded = settingsQuery.isSuccess

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prompt stacks</CardTitle>
        <CardDescription>
          Ordered modules that build model context. Reorder Chat history like
          any other row; inject with Relative or In chat depth. Edits apply
          everywhere this stack is used.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          {selected ? (
            <Select
              value={selected.id}
              items={Object.fromEntries(stacks.map((s) => [s.id, s.name]))}
              onValueChange={(id) => {
                if (id == null) return
                setSelectedId(String(id))
                setDraft(null)
              }}
              disabled={!loaded || stacks.length === 0}
            >
              <SelectTrigger className="min-w-[12rem]">
                <SelectValue placeholder="Select a stack" />
              </SelectTrigger>
              <SelectContent>
                {stacks.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                    {s.id === defaultId ? " (default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-w-[12rem] justify-start rounded-4xl"
              disabled
            >
              {loaded ? "No stacks" : "Loading…"}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!loaded || createMut.isPending}
            onClick={() =>
              createMut.mutate({
                name: "New stack",
                stack: defaultPromptStack(),
              })
            }
          >
            New
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!selected || duplicateMut.isPending}
            onClick={() => selected && duplicateMut.mutate({ id: selected.id })}
          >
            Duplicate
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!selected || isDefault || setDefaultMut.isPending}
            onClick={() =>
              selected && setDefaultMut.mutate({ stackId: selected.id })
            }
          >
            {isDefault ? "Instance default" : "Set as default"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!selected || isDefault || deleteMut.isPending}
            onClick={() => {
              if (!selected) return
              if (
                !window.confirm(
                  `Delete stack “${selected.name}”? Chats using it will fall back to the instance default.`
                )
              )
                return
              deleteMut.mutate({ id: selected.id })
            }}
          >
            Delete
          </Button>
        </div>

        {selected ? (
          <div className="space-y-4">
            {isDefault ? (
              <p className="text-xs text-muted-foreground">
                This is the instance default. Changes apply to every chat that
                inherits it.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Changes apply to every chat using this stack.
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="stack-name">Name</Label>
              <Input
                id="stack-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Modules</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setModules([...modules, createEmptyModule("relative")])
                  }
                >
                  Add module
                </Button>
              </div>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
              >
                <SortableContext
                  items={modules.map((m) => m.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="space-y-2">
                    {modules.map((mod) =>
                      mod.kind === "history" ? (
                        <SortableHistoryModule
                          key={mod.id}
                          module={mod}
                          onEnabledChange={(enabled) =>
                            updateHistoryEnabled(mod.id, enabled)
                          }
                        />
                      ) : mod.kind === "mcp-instructions" ? (
                        <SortableMcpInstructionsModule
                          key={mod.id}
                          module={mod}
                          onEnabledChange={(enabled) =>
                            setModules(
                              modules.map((item) =>
                                item.id === mod.id &&
                                item.kind === "mcp-instructions"
                                  ? { ...item, enabled }
                                  : item
                              )
                            )
                          }
                        />
                      ) : (
                        <SortablePromptModule
                          key={mod.id}
                          module={mod}
                          warnSystem={warningIds.has(mod.id)}
                          onChange={(patch) =>
                            updatePromptModule(mod.id, patch)
                          }
                          onRemove={() =>
                            setModules(modules.filter((m) => m.id !== mod.id))
                          }
                        />
                      )
                    )}
                  </ul>
                </SortableContext>
              </DndContext>
            </div>

            <Button
              type="button"
              disabled={!dirty || updateMut.isPending}
              onClick={save}
            >
              Save stack
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {loaded ? "No prompt stacks yet." : "Loading…"}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function sortableStyle(
  transform: Parameters<typeof CSS.Translate.toString>[0],
  transition: string | undefined
) {
  // Use Translate only — CSS.Transform applies scale when rows differ in height and
  // visually stretches the dragged item.
  return {
    transform: CSS.Translate.toString(transform),
    transition,
  }
}

function SortableHistoryModule({
  module: mod,
  onEnabledChange,
}: {
  module: Extract<StackModule, { kind: "history" }>
  onEnabledChange: (enabled: boolean) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: mod.id })

  return (
    <li
      ref={setNodeRef}
      style={sortableStyle(transform, transition)}
      className={cn(
        "relative rounded-lg border border-dashed bg-muted/30 p-3",
        isDragging && "z-10 opacity-40 shadow-none"
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <HugeiconsIcon icon={DragDropVerticalIcon} className="size-4" />
        </button>
        <Switch
          checked={mod.enabled}
          onCheckedChange={onEnabledChange}
          size="sm"
        />
        <span className="text-sm font-medium">{mod.name}</span>
        <Badge variant="outline" className="ml-1">
          Path
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          Active branch path as conversation history
        </span>
      </div>
    </li>
  )
}

function SortableMcpInstructionsModule({
  module: mod,
  onEnabledChange,
}: {
  module: Extract<StackModule, { kind: "mcp-instructions" }>
  onEnabledChange: (enabled: boolean) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: mod.id })

  return (
    <li
      ref={setNodeRef}
      style={sortableStyle(transform, transition)}
      className={cn(
        "relative rounded-lg border border-dashed bg-muted/30 p-3",
        isDragging && "z-10 opacity-40 shadow-none"
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <HugeiconsIcon icon={DragDropVerticalIcon} className="size-4" />
        </button>
        <Switch
          checked={mod.enabled}
          onCheckedChange={onEnabledChange}
          size="sm"
        />
        <span className="text-sm font-medium">{mod.name}</span>
        <Badge variant="outline" className="ml-1">
          Server instructions
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          Places MCP initialize instructions
        </span>
      </div>
    </li>
  )
}

function SortablePromptModule({
  module: mod,
  warnSystem,
  onChange,
  onRemove,
}: {
  module: PromptModule
  warnSystem: boolean
  onChange: (patch: Partial<PromptModule>) => void
  onRemove: () => void
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: mod.id })

  const displayName = mod.name.trim() || "Untitled module"

  return (
    <li
      ref={setNodeRef}
      style={sortableStyle(transform, transition)}
      className={cn(
        "relative rounded-lg border bg-card p-3",
        isDragging && "z-10 opacity-40 shadow-none"
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-1 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <HugeiconsIcon icon={DragDropVerticalIcon} className="size-4" />
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Switch
              checked={mod.enabled}
              onCheckedChange={(enabled) => onChange({ enabled })}
              size="sm"
            />
            <Input
              value={mod.name}
              onChange={(e) => onChange({ name: e.target.value })}
              className="h-8 max-w-[10rem]"
              aria-label="Module name"
            />
            <Badge variant="secondary">{placementLabel(mod.placement)}</Badge>
            {mod.placement === "in_chat" ? (
              <Badge variant="outline">depth {mod.depth ?? 0}</Badge>
            ) : null}
            <Select
              value={mod.placement}
              items={PLACEMENT_ITEMS}
              onValueChange={(v) => {
                if (v === "relative" || v === "in_chat")
                  onChange({
                    placement: v,
                    ...(v === "in_chat" ? { depth: mod.depth ?? 0 } : {}),
                  })
              }}
            >
              <SelectTrigger size="sm" className="min-w-[8rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLACEMENTS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {placementLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {mod.placement === "in_chat" ? (
              <Input
                type="number"
                min={0}
                value={mod.depth ?? 0}
                onChange={(e) =>
                  onChange({ depth: Math.max(0, Number(e.target.value) || 0) })
                }
                className="h-8 w-20"
                aria-label="Insertion depth from end of history"
              />
            ) : null}
            <Select
              value={mod.role}
              items={ROLE_ITEMS}
              onValueChange={(v) => {
                if (v === "system" || v === "user" || v === "assistant")
                  onChange({ role: v })
              }}
            >
              <SelectTrigger size="sm" className="min-w-[6rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">system</SelectItem>
                <SelectItem value="user">user</SelectItem>
                <SelectItem value="assistant">assistant</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              onClick={() => setDeleteOpen(true)}
              aria-label="Remove module"
            >
              <HugeiconsIcon icon={Delete02Icon} className="size-4" />
            </Button>
          </div>
          {warnSystem ? (
            <p className="text-xs text-muted-foreground">
              System after chat or non-system may be remapped to assistant for
              some providers.
            </p>
          ) : null}
          <Textarea
            value={mod.body}
            onChange={(e) => onChange({ body: e.target.value })}
            rows={3}
            placeholder="Module body…"
            className="text-sm"
          />
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete module?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove “{displayName}” from this stack. Save the stack to make
              this permanent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                onRemove()
                setDeleteOpen(false)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}
