"use client"

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  Delete02Icon,
  DragDropVerticalIcon,
} from "@hugeicons/core-free-icons"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import {
  convertPart,
  createEditorPart,
  editorPartTypesForRole,
  isEmptyParts,
  roleConversionLosses,
  type ConversationAuthorRole,
  type EditorPartType,
} from "@/lib/agent/parts"
import type { Part, Parts, ToolInvocationPart } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ContextPreviewStrip } from "../context-preview"
import type { ComposerAttachment } from "../conversation-session-store"
import { attachmentMatchesPart } from "../conversation-session-store"
import { MessageParts } from "../message-parts"
import { ToolBlockEditor, type ToolDraftCommit } from "./tool-block"
import {
  applyFieldHeightCap,
  editorFieldMaxHeight,
  editorFieldMinHeight,
  fieldOverflow,
  fieldOverflowEqual,
  type EditorPlacement,
} from "./layout"
import { EditorShell } from "./shell"

const sourceEditorClass =
  "min-h-[4.5rem] resize-none rounded-none border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0"

const TYPE_LABEL: Record<EditorPartType, string> = {
  text: "Text",
  reasoning: "Reasoning",
  "tool-invocation": "Tool record",
}

export function PartsEditor({
  role,
  parts,
  keys,
  attachments = [],
  overlayNodeId,
  variant = "inline",
  submitting = false,
  animate = true,
  showContextPreview = false,
  onReplacePart,
  onInsertPart,
  onRemovePart,
  onMovePart,
  onConvertRole,
  onSend,
  onCancel,
  onRevealContextMessage,
  sendLabel = "Save branch",
  placement = "linear",
  onReplace,
  onFiles,
  onRemoveAttachment,
  allowAttachments = false,
}: {
  role: ConversationAuthorRole
  parts: Parts
  keys: string[]
  attachments?: ComposerAttachment[]
  overlayNodeId: string
  variant?: "docked" | "inline"
  submitting?: boolean
  animate?: boolean
  showContextPreview?: boolean
  onReplacePart: (index: number, part: Part) => void
  onInsertPart: (index: number, part: Part) => void
  onRemovePart: (index: number) => void
  onMovePart: (from: number, to: number) => void
  onConvertRole: (role: ConversationAuthorRole) => void
  onSend: () => void
  onCancel?: () => void
  onRevealContextMessage?: (nodeId: string) => void
  sendLabel?: string
  placement?: EditorPlacement
  onReplace?: () => void
  onFiles?: (files: File[] | FileList) => void
  onRemoveAttachment?: (part: ComposerAttachment) => void
  allowAttachments?: boolean
}) {
  const [convertOpen, setConvertOpen] = useState(false)
  const [invalidTools, setInvalidTools] = useState<Record<string, boolean>>({})
  const toolCommitters = useRef(new Map<string, () => ToolDraftCommit>())
  const registerToolCommit = useCallback(
    (id: string, commit: () => ToolDraftCommit) => {
      toolCommitters.current.set(id, commit)
      return () => {
        if (toolCommitters.current.get(id) === commit)
          toolCommitters.current.delete(id)
      }
    },
    []
  )
  const targetRole: ConversationAuthorRole =
    role === "user" ? "assistant" : "user"
  const losses = roleConversionLosses(parts, role, targetRole)
  const insertTypes = editorPartTypesForRole(role)
  const pendingUploads = attachments.filter(
    (item) =>
      !parts.some(
        (part) => part.type === "attachment" && attachmentMatchesPart(item, part)
      )
  )
  const empty = parts.length === 0
  const ids = keys.length === parts.length ? keys : parts.map((_, i) => String(i))
  const sendDisabled =
    submitting ||
    attachments.some((item) => item.uploading) ||
    ids.some(
      (id, index) => parts[index]?.type === "tool-invocation" && invalidTools[id]
    ) ||
    (isEmptyParts(parts) && pendingUploads.length === 0)
  const commitToolDrafts = () => {
    const drafts = ids.flatMap((id, index) => {
      if (parts[index]?.type !== "tool-invocation") return []
      const prepare = toolCommitters.current.get(id)
      return prepare ? [prepare()] : []
    })
    if (drafts.some((draft) => !draft.valid)) return false
    for (const draft of drafts) draft.commit()
    return true
  }
  const send = () => {
    if (submitting || attachments.some((item) => item.uploading)) return
    if (!commitToolDrafts()) return
    if (isEmptyParts(parts) && pendingUploads.length === 0) return
    onSend()
  }
  const replace = () => {
    if (!commitToolDrafts()) return
    onReplace?.()
  }
  const overlay = useMemo(
    () => ({ nodeId: overlayNodeId, parts }),
    [overlayNodeId, parts]
  )
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = keys.indexOf(String(active.id))
    const to = keys.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    onMovePart(from, to)
  }

  return (
    <EditorShell
      variant={variant}
      submitting={submitting}
      animate={animate}
      contextPreview={
        showContextPreview ? (
          <ContextPreviewStrip
            contextParentId={overlayNodeId}
            overlay={overlay}
            onRevealMessage={onRevealContextMessage}
          />
        ) : null
      }
      footerStart={
        <>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={submitting}
            onClick={() => setConvertOpen(true)}
          >
            Convert to {targetRole}
          </Button>
          {allowAttachments && onFiles ? (
            <AttachmentInsert disabled={submitting} onFiles={onFiles} />
          ) : null}
        </>
      }
      sendLabel={sendLabel}
      sendDisabled={sendDisabled}
      onSend={send}
      onCancel={onCancel}
      onReplace={onReplace ? replace : undefined}
      replaceLabel="Replace"
      hint="⌘/Ctrl + Enter to save · Esc to cancel"
      expandable={false}
    >
      <PartsField
        inline={variant === "inline"}
        placement={placement}
        disabled={submitting}
        onSend={send}
        onCancel={onCancel}
      >
        {pendingUploads.length > 0 ? (
          <ul className="mb-2 flex flex-wrap gap-1.5">
            {pendingUploads.map((item) => (
              <li
                key={
                  item.reference.kind === "uploaded-file"
                    ? item.reference.id
                    : `${item.reference.profileId}:${item.reference.uri}`
                }
                className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-xs"
              >
                {item.uploading ? "Uploading… " : null}
                {item.name}
                {onRemoveAttachment ? (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${item.name}`}
                    disabled={submitting}
                    onClick={() => onRemoveAttachment(item)}
                  >
                    ×
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-2">
              {empty ? (
                <li className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  Empty message. Insert a block to start.
                </li>
              ) : (
                parts.map((part, index) => (
                  <SortablePartBlock
                    key={ids[index] ?? index}
                    id={ids[index] ?? String(index)}
                    index={index}
                    part={part}
                    insertTypes={insertTypes}
                    disabled={submitting}
                    autoFocus={index === 0}
                    onChange={(next) => onReplacePart(index, next)}
                    onRemove={() => {
                      if (part.type === "attachment" && onRemoveAttachment) {
                        const match = attachments.find((item) =>
                          attachmentMatchesPart(item, part)
                        )
                        if (match) onRemoveAttachment(match)
                      }
                      onRemovePart(index)
                    }}
                    onInsert={(at, type) =>
                      onInsertPart(at, createEditorPart(type))
                    }
                    onConvert={(type) =>
                      onReplacePart(index, convertPart(part, type))
                    }
                    onToolValidity={(valid) => {
                      const id = ids[index] ?? String(index)
                      setInvalidTools((current) => {
                        if (!valid) {
                          if (current[id]) return current
                          return { ...current, [id]: true }
                        }
                        if (!current[id]) return current
                        const next = { ...current }
                        delete next[id]
                        return next
                      })
                    }}
                    onRegisterToolCommit={(commit) =>
                      registerToolCommit(ids[index] ?? String(index), commit)
                    }
                  />
                ))
              )}
            </ul>
          </SortableContext>
        </DndContext>
        <div className="pt-1">
          <InsertPartMenu
            types={insertTypes}
            disabled={submitting}
            onInsert={(type) =>
              onInsertPart(parts.length, createEditorPart(type))
            }
          />
        </div>
      </PartsField>
      <AlertDialog open={convertOpen} onOpenChange={setConvertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Convert to {targetRole} message?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {losses.length
                ? losses.join(" ")
                : "The message stays in this editor until you save or replace."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onConvertRole(targetRole)
                setConvertOpen(false)
              }}
            >
              Convert
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </EditorShell>
  )
}

function AttachmentInsert({
  disabled,
  onFiles,
}: {
  disabled: boolean
  onFiles: (files: File[] | FileList) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        Attach
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.pdf"
        multiple
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          if (event.target.files) onFiles(event.target.files)
          event.target.value = ""
        }}
      />
    </>
  )
}

function InsertPartMenu({
  types,
  disabled,
  onInsert,
}: {
  types: EditorPartType[]
  disabled: boolean
  onInsert: (type: EditorPartType) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="gap-1"
            disabled={disabled}
          />
        }
      >
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-3.5" />
        Add block
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {types.map((type) => (
          <DropdownMenuItem key={type} onClick={() => onInsert(type)}>
            {TYPE_LABEL[type]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SortablePartBlock({
  id,
  index,
  part,
  insertTypes,
  disabled,
  autoFocus,
  onChange,
  onRemove,
  onInsert,
  onConvert,
  onToolValidity,
  onRegisterToolCommit,
}: {
  id: string
  index: number
  part: Part
  insertTypes: EditorPartType[]
  disabled: boolean
  autoFocus: boolean
  onChange: (part: Part) => void
  onRemove: () => void
  onInsert: (index: number, type: EditorPartType) => void
  onConvert: (type: EditorPartType) => void
  onToolValidity: (valid: boolean) => void
  onRegisterToolCommit: (
    commit: () => ToolDraftCommit
  ) => void | (() => void)
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })
  const convertTypes = insertTypes.filter((type) => type !== part.type)
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "rounded-lg border bg-background/40 p-2",
        isDragging && "z-10 opacity-60"
      )}
    >
      <div className="mb-1 flex items-center gap-1">
        <button
          type="button"
          className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
          aria-label="Drag to reorder"
          disabled={disabled}
          {...attributes}
          {...listeners}
        >
          <HugeiconsIcon icon={DragDropVerticalIcon} className="size-4" />
        </button>
        <Badge variant="outline" className="capitalize">
          {part.type === "tool-invocation" ? "Tool" : part.type}
        </Badge>
        {convertTypes.length > 0 && part.type !== "attachment" ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="h-6 px-1.5 text-xs"
                  disabled={disabled}
                />
              }
            >
              Convert
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {convertTypes.map((type) => (
                <DropdownMenuItem key={type} onClick={() => onConvert(type)}>
                  {TYPE_LABEL[type]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <InsertPartMenu
          types={insertTypes}
          disabled={disabled}
          onInsert={(type) => onInsert(index + 1, type)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="ml-auto size-6 text-muted-foreground"
          aria-label="Delete block"
          disabled={disabled}
          onClick={onRemove}
        >
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
        </Button>
      </div>
      <PartBlockBody
        part={part}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={onChange}
        onToolValidity={onToolValidity}
        onRegisterToolCommit={onRegisterToolCommit}
      />
    </li>
  )
}

function PartBlockBody({
  part,
  disabled,
  autoFocus,
  onChange,
  onToolValidity,
  onRegisterToolCommit,
}: {
  part: Part
  disabled: boolean
  autoFocus: boolean
  onChange: (part: Part) => void
  onToolValidity: (valid: boolean) => void
  onRegisterToolCommit: (
    commit: () => ToolDraftCommit
  ) => void | (() => void)
}) {
  if (part.type === "text" || part.type === "reasoning") {
    return (
      <Textarea
        autoFocus={autoFocus}
        aria-label={part.type === "reasoning" ? "Reasoning" : "Message text"}
        value={part.text}
        disabled={disabled}
        onChange={(event) =>
          onChange({ type: part.type, text: event.target.value })
        }
        rows={part.type === "reasoning" ? 3 : 4}
        className={cn(sourceEditorClass, part.type === "reasoning" && "text-xs")}
      />
    )
  }
  if (part.type === "tool-invocation") {
    return (
      <ToolBlockEditor
        part={part}
        disabled={disabled}
        onChange={(next: ToolInvocationPart) => onChange(next)}
        onValidityChange={onToolValidity}
        onRegisterCommit={onRegisterToolCommit}
      />
    )
  }
  return <MessageParts parts={[part]} />
}

function PartsField({
  inline,
  placement,
  disabled,
  onSend,
  onCancel,
  children,
}: {
  inline: boolean
  placement: EditorPlacement
  disabled: boolean
  onSend: () => void
  onCancel?: () => void
  children: React.ReactNode
}) {
  const fieldRef = useRef<HTMLDivElement>(null)
  const surface = inline ? "inline" : "docked"
  const [overflow, setOverflow] = useState(
    fieldOverflow({
      scrollTop: 0,
      scrollHeight: 0,
      clientHeight: 0,
    })
  )

  const syncField = useCallback(() => {
    const el = fieldRef.current
    if (!el) return
    applyFieldHeightCap(el)
    const next = fieldOverflow(el)
    setOverflow((prev) => (fieldOverflowEqual(prev, next) ? prev : next))
  }, [])

  useLayoutEffect(() => {
    syncField()
  }, [syncField, children])

  useLayoutEffect(() => {
    const el = fieldRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(syncField)
    observer.observe(el)
    return () => observer.disconnect()
  }, [syncField])

  return (
    <div className="relative min-h-0">
      <div
        ref={fieldRef}
        data-composer-field=""
        data-tree-scroll={inline ? "" : undefined}
        tabIndex={-1}
        onScroll={syncField}
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.nativeEvent.isComposing) return
          if (event.key === "Escape") {
            if (!onCancel) return
            event.preventDefault()
            event.stopPropagation()
            onCancel()
            return
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            if (event.repeat || disabled) return
            onSend()
          }
        }}
        style={{
          minHeight: editorFieldMinHeight({
            purpose: "edit",
            surface,
          }),
          maxHeight: editorFieldMaxHeight({
            purpose: "edit",
            surface,
            placement,
          }),
          overflowY: "auto",
        }}
        className="[touch-action:pan-y] overflow-y-auto overscroll-contain px-2 py-1"
      >
        {children}
      </div>
      {overflow.top ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-composer to-transparent"
        />
      ) : null}
      {overflow.bottom ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-composer to-transparent"
        />
      ) : null}
    </div>
  )
}
