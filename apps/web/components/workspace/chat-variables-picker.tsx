"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  isOrphanPromptStackRef,
  parsePromptVariableValues,
  reconcilePromptVariableDraft,
  resolvePromptVariableValues,
  type PromptVariable,
  type PromptVariableValues,
} from "@/lib/prompt-stack"
import { useTRPC } from "@/lib/trpc-react"
import type { SpaceLockSource } from "@/lib/space"
import { SpaceLockHint } from "./space-lock-hint"
import { useMediaMdUp } from "./hooks"
import {
  STRING_VARIABLE_FOCUS_DIALOG_CLASS,
  StringVariableEditor,
  StringVariableField,
  StringVariableFocusDialog,
} from "./string-variable-field"

const EMPTY_VALUES: PromptVariableValues = {}
const EMPTY_VARIABLES: PromptVariable[] = []

function sameValues(left: PromptVariableValues, right: PromptVariableValues) {
  return (
    left === right ||
    (Object.keys(left).length === Object.keys(right).length &&
      Object.keys(right).every((name) => left[name] === right[name]))
  )
}

function explicitOverrides(
  variables: readonly PromptVariable[],
  values: PromptVariableValues
): PromptVariableValues {
  const overrides: PromptVariableValues = {}
  for (const variable of variables) {
    const value = values[variable.name]
    if (value === undefined || value === variable.default) continue
    overrides[variable.name] = value
  }
  return overrides
}

type PromptStringVariable = Extract<PromptVariable, { type: "string" }>

type OverlayFocus = {
  name: string
  snapshot: string
  returnToList: boolean
}

type Overlay = {
  identity: string
  listOpen: boolean
  focus: OverlayFocus | null
}

function reconcileOverlay(
  overlay: Overlay,
  identity: string,
  variables: readonly PromptVariable[]
): Overlay & { focusVariable: PromptStringVariable | undefined } {
  const sameIdentity = overlay.identity === identity
  const listOpen =
    sameIdentity && variables.length > 0 ? overlay.listOpen : false
  const requestedFocus = sameIdentity ? overlay.focus : null
  const focusVariable = requestedFocus
    ? variables.find(
        (variable): variable is PromptStringVariable =>
          variable.name === requestedFocus.name && variable.type === "string"
      )
    : undefined
  return {
    identity,
    listOpen,
    focus: focusVariable ? requestedFocus : null,
    focusVariable,
  }
}

function TriggerLabel({ label, custom }: { label: string; custom: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate">{label}</span>
      {custom ? (
        <span
          className="size-1.5 shrink-0 rounded-full bg-primary"
          title="Custom values"
          aria-hidden
        />
      ) : null}
    </span>
  )
}

export function ChatVariablesPicker({
  chatId,
  promptStackId,
  draftStackId,
  variablesJson = "{}",
  draftValues = EMPTY_VALUES,
  onDraftChange,
  onChanged,
  lockedVariables,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: {
  chatId?: string
  promptStackId: string | null
  draftStackId?: string | null
  variablesJson?: string
  draftValues?: PromptVariableValues
  onDraftChange?: (values: PromptVariableValues) => void
  onChanged?: () => void | Promise<void>
  lockedVariables?: Record<string, SpaceLockSource>
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}) {
  const trpc = useTRPC()
  const mdUp = useMediaMdUp()
  const settingsQuery = useQuery(trpc.workspace.getSettings.queryOptions())
  const stacks = settingsQuery.data?.promptStacks ?? []
  const defaultId = settingsQuery.data?.defaultPromptStackId ?? null
  const defaultStack = stacks.find((stack) => stack.id === defaultId)
  const activeRef = chatId ? promptStackId : (draftStackId ?? null)
  const selectedStack = activeRef
    ? stacks.find((stack) => stack.id === activeRef)
    : null
  const isOrphan = isOrphanPromptStackRef(activeRef, stacks)
  const effectiveStack = isOrphan
    ? defaultStack
    : (selectedStack ?? defaultStack)
  const variables = effectiveStack?.stack.variables ?? EMPTY_VARIABLES
  const storedOverrides = useMemo(
    () => (chatId ? parsePromptVariableValues(variablesJson) : draftValues),
    [chatId, variablesJson, draftValues]
  )
  const resolved = useMemo(
    () => resolvePromptVariableValues(variables, storedOverrides),
    [variables, storedOverrides]
  )
  const identity = `${chatId ?? "draft"}:${effectiveStack?.id ?? "none"}:${variablesJson}`
  const sessionIdentity = `${chatId ?? "draft"}:${effectiveStack?.id ?? "none"}`
  const [state, setState] = useState({ identity, resolved, draft: resolved })
  const [overlay, setOverlay] = useState<Overlay>({
    identity: sessionIdentity,
    listOpen: false,
    focus: null,
  })
  let current = state
  if (state.identity !== identity) {
    current = { identity, resolved, draft: resolved }
  } else if (!sameValues(state.resolved, resolved)) {
    const draft = reconcilePromptVariableDraft(
      variables,
      state.resolved,
      state.draft,
      resolved
    )
    current = { identity, resolved, draft }
  }
  // Reconcile before rendering or committing, without an effect-driven commit.
  if (current !== state) setState(current)
  const draftForRender = current.draft
  const nextOverlay = reconcileOverlay(overlay, sessionIdentity, variables)
  if (
    overlay.identity !== nextOverlay.identity ||
    overlay.listOpen !== nextOverlay.listOpen ||
    overlay.focus !== nextOverlay.focus
  ) {
    setOverlay({
      identity: nextOverlay.identity,
      listOpen: nextOverlay.listOpen,
      focus: nextOverlay.focus,
    })
  }
  const { listOpen, focus, focusVariable } = nextOverlay

  function setDraft(next: PromptVariableValues) {
    setState({ ...current, draft: next })
  }

  const saveMut = useMutation(
    trpc.workspace.setChatVariables.mutationOptions({
      onSuccess: async () => {
        await onChanged?.()
      },
      onError: (error) =>
        toast.error(error.message || "Could not save variables"),
    })
  )

  if (!variables.length) return null

  const onlyString =
    variables.length === 1 && variables[0]?.type === "string"
      ? variables[0]
      : null
  const hasCustom =
    Object.keys(explicitOverrides(variables, draftForRender)).length > 0

  function commit(next: PromptVariableValues) {
    setDraft(next)
    const overrides = explicitOverrides(variables, next)
    if (!chatId) {
      onDraftChange?.(overrides)
      return
    }
    saveMut.mutate({ chatId, values: overrides })
  }

  function stringValue(name: string, fallback = "") {
    const value = draftForRender[name]
    return typeof value === "string" ? value : fallback
  }

  const overlayOpen = listOpen || Boolean(focus)
  if (openProp === true && !overlayOpen) {
    if (onlyString) {
      setOverlay({
        identity: sessionIdentity,
        listOpen: false,
        focus: {
          name: onlyString.name,
          snapshot: stringValue(onlyString.name, onlyString.default),
          returnToList: false,
        },
      })
    } else {
      setOverlay({
        identity: sessionIdentity,
        listOpen: true,
        focus: null,
      })
    }
  } else if (openProp === false && overlayOpen) {
    setOverlay({
      identity: sessionIdentity,
      listOpen: false,
      focus: null,
    })
  }

  function setListOpen(next: boolean) {
    setOverlay({
      identity: sessionIdentity,
      listOpen: next,
      focus,
    })
  }

  function openFocus(name: string, returnToList: boolean) {
    const variable = variables.find((item) => item.name === name)
    const snapshot = stringValue(
      name,
      variable?.type === "string" ? variable.default : ""
    )
    setOverlay({
      identity: sessionIdentity,
      listOpen: returnToList,
      focus: { name, snapshot, returnToList },
    })
    if (!sameValues(draftForRender, resolved)) commit(draftForRender)
  }

  function closeFocus(commitValue?: string) {
    if (commitValue !== undefined && focus && !lockedVariables?.[focus.name]) {
      commit({ ...draftForRender, [focus.name]: commitValue })
    }
    const returnToList = focus?.returnToList ?? false
    setOverlay({
      identity: sessionIdentity,
      listOpen: returnToList,
      focus: null,
    })
    if (!returnToList) onOpenChange?.(false)
  }

  function openFromTrigger() {
    if (onlyString) {
      openFocus(onlyString.name, false)
      return
    }
    setListOpen(true)
  }

  const body = (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Values for this conversation. Unchanged fields keep the stack default.
      </p>
      {variables.map((variable) => {
        const value = draftForRender[variable.name] ?? variable.default
        const custom = value !== variable.default
        const stringVal = typeof value === "string" ? value : ""
        const lock = lockedVariables?.[variable.name]
        const fieldDisabled = saveMut.isPending || Boolean(lock)
        return (
          <div key={variable.name} className="grid gap-1">
            {variable.type === "boolean" ? (
              <>
                <Label className="text-[11px]" htmlFor={`var-${variable.name}`}>
                  {variable.name}
                  {custom ? (
                    <span className="font-normal text-muted-foreground">
                      Custom
                    </span>
                  ) : null}
                </Label>
                {variable.description ? (
                  <p className="text-xs text-muted-foreground">
                    {variable.description}
                  </p>
                ) : null}
                <div className="flex items-center gap-2">
                  <Switch
                    id={`var-${variable.name}`}
                    size="sm"
                    checked={Boolean(value)}
                    disabled={fieldDisabled}
                    onCheckedChange={(checked) =>
                      commit({ ...draftForRender, [variable.name]: checked })
                    }
                  />
                  <span className="text-sm text-muted-foreground">
                    {value ? "On" : "Off"}
                  </span>
                </div>
                <SpaceLockHint lock={lock} />
              </>
            ) : mdUp ? (
              <>
                <Label className="text-[11px]" htmlFor={`var-${variable.name}`}>
                  {variable.name}
                  {custom ? (
                    <span className="font-normal text-muted-foreground">
                      Custom
                    </span>
                  ) : null}
                </Label>
                {variable.description ? (
                  <p className="text-xs text-muted-foreground">
                    {variable.description}
                  </p>
                ) : null}
                <StringVariableField
                  id={`var-${variable.name}`}
                  compact
                  value={stringVal}
                  placeholder="Value"
                  ariaLabel={variable.name}
                  disabled={fieldDisabled}
                  onChange={(next) =>
                    setDraft({
                      ...draftForRender,
                      [variable.name]: next,
                    })
                  }
                  onBlur={() => {
                    if (
                      draftForRender[variable.name] === resolved[variable.name]
                    )
                      return
                    commit(draftForRender)
                  }}
                  onExpand={() => openFocus(variable.name, false)}
                />
                <SpaceLockHint lock={lock} />
              </>
            ) : (
              <button
                type="button"
                className="flex items-center gap-2 rounded-xl border border-transparent px-1 py-1 text-left transition-colors hover:border-border hover:bg-muted/40"
                disabled={fieldDisabled}
                aria-label={`Edit ${variable.name}`}
                onClick={() => openFocus(variable.name, true)}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[11px] font-medium">
                    {variable.name}
                    {custom ? (
                      <span className="font-normal text-muted-foreground">
                        Custom
                      </span>
                    ) : null}
                  </span>
                  {variable.description ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {variable.description}
                    </span>
                  ) : null}
                  <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                    {stringVal.replace(/\s+/g, " ").trim() || "Empty"}
                  </span>
                </span>
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  className="size-4 shrink-0 text-muted-foreground"
                  strokeWidth={2}
                />
              </button>
            )}
            {variable.type !== "boolean" && !mdUp ? (
              <SpaceLockHint lock={lock} />
            ) : null}
          </div>
        )
      })}
    </div>
  )

  const triggerLabel =
    variables.length === 1 ? variables[0]!.name : `${variables.length} vars`

  function handleDialogOpenChange(open: boolean) {
    if (open) {
      openFromTrigger()
      return
    }
    if (focus?.returnToList) {
      setOverlay({
        identity: sessionIdentity,
        listOpen: true,
        focus: null,
      })
      return
    }
    setOverlay({
      identity: sessionIdentity,
      listOpen: false,
      focus: null,
    })
    onOpenChange?.(false)
  }

  const overlayDialog = (
    <Dialog
      open={listOpen || Boolean(focus)}
      onOpenChange={handleDialogOpenChange}
    >
      <DialogContent
        showCloseButton={!focus}
        className={
          focus
            ? STRING_VARIABLE_FOCUS_DIALOG_CLASS
            : "flex max-h-[90dvh] flex-col gap-3 overflow-y-auto sm:max-w-md"
        }
      >
        {focus && focusVariable ? (
          <StringVariableEditor
            key={focus.name}
            title={focusVariable.name}
            description={focusVariable.description}
            initialValue={focus.snapshot}
            defaultValue={focusVariable.default}
            disabled={Boolean(lockedVariables?.[focus.name])}
            onCommit={(value) => closeFocus(value)}
            onCancel={() => closeFocus()}
            onBack={
              focus.returnToList
                ? () =>
                    setOverlay({
                      identity: sessionIdentity,
                      listOpen: true,
                      focus: null,
                    })
                : undefined
            }
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Chat variables</DialogTitle>
            </DialogHeader>
            {body}
          </>
        )}
      </DialogContent>
    </Dialog>
  )

  if (hideTrigger) return overlayDialog

  if (mdUp) {
    return (
      <>
        <Popover
          open={listOpen}
          onOpenChange={(open) => {
            if (open && onlyString) {
              openFocus(onlyString.name, false)
              return
            }
            setListOpen(open)
          }}
        >
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="max-w-[min(8rem,22vw)] min-w-0"
                title={
                  hasCustom ? "Chat variables, custom values" : "Chat variables"
                }
                aria-label={
                  hasCustom ? "Chat variables, custom values" : "Chat variables"
                }
              />
            }
          >
            <TriggerLabel label={triggerLabel} custom={hasCustom} />
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="max-h-[min(36rem,calc(100dvh-6rem))] w-[min(24rem,calc(100vw-2rem))] gap-3 overflow-y-auto p-3"
          >
            {body}
          </PopoverContent>
        </Popover>
        <StringVariableFocusDialog
          open={Boolean(focus && focusVariable)}
          title={focusVariable?.name ?? ""}
          description={focusVariable?.description}
          initialValue={focus?.snapshot ?? ""}
          defaultValue={focusVariable?.default}
          disabled={Boolean(focus && lockedVariables?.[focus.name])}
          onCommit={(value) => closeFocus(value)}
          onOpenChange={(open) => {
            if (!open) closeFocus()
          }}
        />
      </>
    )
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="max-w-[7rem] min-w-0 px-2"
        onClick={openFromTrigger}
        title={hasCustom ? "Chat variables, custom values" : "Chat variables"}
        aria-label={
          hasCustom ? "Chat variables, custom values" : "Chat variables"
        }
      >
        <TriggerLabel label="Vars" custom={hasCustom} />
      </Button>
      {overlayDialog}
    </>
  )
}
