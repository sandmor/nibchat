"use client"

import { useMemo, useRef, useState } from "react"
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
import { type CodeEditorHandle } from "@/components/ui/code-editor"
import { cn } from "@/lib/utils"
import {
  builtInMacroDefinitions,
  catalogMacroContext,
  createMacroRegistry,
  expandPromptMacros,
  normalizeTimeZone,
  type MacroDefinition,
} from "@/lib/prompt-macros"
import { useTRPC } from "@/lib/trpc-react"
import {
  createEmptyModule,
  defaultPromptStack,
  findSystemAfterNonSystemWarnings,
  placementLabel,
  resolvePromptVariableValues,
  type ModulePlacement,
  type PromptModule,
  type PromptVariable,
  type PromptStackDocument,
  type StackModule,
} from "@/lib/prompt-stack"
import { MacroPicker } from "./macro-picker"
import { MacroEditor } from "./macro-editor"
import {
  StringVariableField,
  StringVariableFocusDialog,
} from "../string-variable-field"
import { useBrowserTimeZone } from "../hooks"

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
    variables: PromptVariable[]
  } | null>(null)
  const activeDraft =
    draft && selected && draft.stackId === selected.id ? draft : null
  const modules = activeDraft?.modules ?? selected?.stack.modules ?? []
  const variables = activeDraft?.variables ?? selected?.stack.variables ?? []
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
        JSON.stringify(selected.stack.modules) ||
      JSON.stringify(activeDraft.variables) !==
        JSON.stringify(selected.stack.variables ?? []))
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
      variables: (base.stack.variables ?? []).map((v) => ({ ...v })),
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
  function setVariables(next: PromptVariable[]) {
    if (!selected) return
    const d = ensureDraft(selected)
    if (d) setDraft({ ...d, variables: next })
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
    const stack: PromptStackDocument = { modules, variables }
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
          any other row; inject with Relative or In chat depth. Prompt bodies
          can expand date, time, chat macros, and per-chat variables at send
          time. Edits apply everywhere this stack is used.
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
                          variables={variables}
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

            <PromptVariablesEditor
              variables={variables}
              onChange={setVariables}
            />

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

const VARIABLE_TYPE_ITEMS = {
  string: "String",
  boolean: "Boolean",
} as const

function nextVariableName(existing: readonly PromptVariable[]): string {
  const names = new Set(existing.map((variable) => variable.name))
  if (!names.has("variable")) return "variable"
  let index = 2
  while (names.has(`variable_${index}`)) index++
  return `variable_${index}`
}

type StringVariableFocus = {
  index: number
  snapshot: string
  count: number
}

function PromptVariablesEditor({
  variables,
  onChange,
}: {
  variables: PromptVariable[]
  onChange: (next: PromptVariable[]) => void
}) {
  const [focus, setFocus] = useState<StringVariableFocus | null>(null)
  const focused =
    focus && focus.count === variables.length ? variables[focus.index] : null
  const focusVariable = focused?.type === "string" ? focused : null
  if (focus && !focusVariable) setFocus(null)

  function patch(index: number, next: PromptVariable) {
    onChange(variables.map((variable, i) => (i === index ? next : variable)))
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Label>Chat variables</Label>
          <p className="text-xs text-muted-foreground">
            Starting values for this stack. Short strings and long prompts both
            work; each chat can override them from the header.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() =>
            onChange([
              ...variables,
              {
                name: nextVariableName(variables),
                type: "string",
                default: "",
              },
            ])
          }
        >
          Add variable
        </Button>
      </div>
      <div className="space-y-3">
        {variables.map((variable, index) => (
          <div key={index} className="space-y-2 rounded-lg border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-8 w-40"
                value={variable.name}
                placeholder="name"
                aria-label={`Variable name ${index + 1}`}
                onChange={(event) =>
                  patch(index, { ...variable, name: event.target.value })
                }
              />
              <Select
                value={variable.type}
                items={VARIABLE_TYPE_ITEMS}
                onValueChange={(type) => {
                  if (type !== "string" && type !== "boolean") return
                  if (type === variable.type) return
                  if (focus?.index === index) setFocus(null)
                  patch(
                    index,
                    type === "boolean"
                      ? {
                          name: variable.name,
                          type: "boolean",
                          default: false,
                          ...(variable.description
                            ? { description: variable.description }
                            : {}),
                        }
                      : {
                          name: variable.name,
                          type: "string",
                          default: "",
                          ...(variable.description
                            ? { description: variable.description }
                            : {}),
                        }
                  )
                }}
              >
                <SelectTrigger size="sm" className="min-w-[7rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="string">String</SelectItem>
                  <SelectItem value="boolean">Boolean</SelectItem>
                </SelectContent>
              </Select>
              {variable.type === "boolean" ? (
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    size="sm"
                    checked={variable.default}
                    onCheckedChange={(checked) =>
                      patch(index, { ...variable, default: checked })
                    }
                  />
                  <span className="text-muted-foreground">
                    {variable.default ? "On" : "Off"} by default
                  </span>
                </label>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => {
                  if (focus?.index === index) setFocus(null)
                  onChange(variables.filter((_, i) => i !== index))
                }}
              >
                Remove
              </Button>
            </div>
            {variable.type === "string" ? (
              <StringVariableField
                compact
                value={variable.default}
                placeholder="Default"
                ariaLabel={`Default for ${variable.name || "variable"}`}
                onChange={(value) =>
                  patch(index, { ...variable, default: value })
                }
                onExpand={() =>
                  setFocus({
                    index,
                    snapshot: variable.default,
                    count: variables.length,
                  })
                }
              />
            ) : null}
            <Input
              className="h-8"
              value={variable.description ?? ""}
              placeholder="Optional description"
              aria-label={`Description for ${variable.name || "variable"}`}
              onChange={(event) => {
                const description = event.target.value
                if (description) {
                  patch(index, { ...variable, description })
                  return
                }
                if (variable.type === "string") {
                  patch(index, {
                    name: variable.name,
                    type: "string",
                    default: variable.default,
                  })
                  return
                }
                patch(index, {
                  name: variable.name,
                  type: "boolean",
                  default: variable.default,
                })
              }}
            />
          </div>
        ))}
      </div>
      <StringVariableFocusDialog
        open={focusVariable !== null}
        title={
          focusVariable?.name.trim()
            ? `Default · ${focusVariable.name}`
            : "Default value"
        }
        description={focusVariable?.description}
        initialValue={focus?.snapshot ?? ""}
        onCommit={(value) => {
          if (focus === null) return
          const current = variables[focus.index]
          if (!current || current.type !== "string") return
          patch(focus.index, { ...current, default: value })
          setFocus(null)
        }}
        onOpenChange={(open) => {
          if (!open) setFocus(null)
        }}
      />
    </div>
  )
}

function PromptModuleBodyEditor({
  value,
  onChange,
  variables = [],
  macros = builtInMacroDefinitions,
}: {
  value: string
  onChange: (body: string) => void
  variables?: readonly PromptVariable[]
  macros?: readonly MacroDefinition[]
}) {
  const editorRef = useRef<CodeEditorHandle>(null)
  const browserTimeZone = useBrowserTimeZone()
  const timeZone = browserTimeZone ? normalizeTimeZone(browserTimeZone) : null
  const registry = useMemo(() => createMacroRegistry(macros), [macros])
  const catalogContext = useMemo(() => {
    if (!timeZone) return null
    return catalogMacroContext(
      timeZone,
      undefined,
      resolvePromptVariableValues(variables)
    )
  }, [timeZone, variables])
  const expanded = useMemo(() => {
    if (!catalogContext) return value
    return expandPromptMacros(value, catalogContext, registry)
  }, [catalogContext, registry, value])
  const showPreview = catalogContext !== null && expanded !== value
  const pickerVariables = useMemo(
    () =>
      variables.map((variable) => ({
        name: variable.name,
        summary: variable.description ?? variable.name,
      })),
    [variables]
  )

  return (
    <div className="space-y-1.5">
      <MacroEditor
        editorRef={editorRef}
        value={value}
        onChange={onChange}
        macros={macros}
        variables={pickerVariables}
        placeholder="Module body…"
        ariaLabel="Module body"
        className="max-h-96 [&_.cm-scroller]:max-h-96"
      />
      <div className="flex items-start gap-2">
        {showPreview ? (
          <p className="max-h-24 min-w-0 flex-1 overflow-y-auto text-xs break-words whitespace-pre-wrap text-muted-foreground">
            <span className="mr-1 text-[11px] tracking-wide text-muted-foreground/80 uppercase">
              Sends as
            </span>
            {expanded}
          </p>
        ) : null}
        <MacroPicker
          macros={macros}
          variables={pickerVariables}
          catalogContext={catalogContext}
          blockSnippets
          onInsert={(snippet) => editorRef.current?.replaceSelection(snippet)}
        />
      </div>
    </div>
  )
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
  variables,
  warnSystem,
  onChange,
  onRemove,
}: {
  module: PromptModule
  variables: readonly PromptVariable[]
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
          <PromptModuleBodyEditor
            value={mod.body}
            variables={variables}
            onChange={(body) => onChange({ body })}
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
