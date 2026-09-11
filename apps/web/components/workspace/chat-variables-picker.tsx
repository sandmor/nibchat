"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { useMediaMdUp } from "./hooks"

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

export function ChatVariablesPicker({
  chatId,
  promptStackId,
  draftStackId,
  variablesJson = "{}",
  draftValues = EMPTY_VALUES,
  onDraftChange,
  onChanged,
}: {
  chatId?: string
  promptStackId: string | null
  draftStackId?: string | null
  variablesJson?: string
  draftValues?: PromptVariableValues
  onDraftChange?: (values: PromptVariableValues) => void
  onChanged?: () => void | Promise<void>
}) {
  const trpc = useTRPC()
  const mdUp = useMediaMdUp()
  const [open, setOpen] = useState(false)
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
  const [state, setState] = useState({ identity, resolved, draft: resolved })
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

  function commit(next: PromptVariableValues) {
    setDraft(next)
    const overrides = explicitOverrides(variables, next)
    if (!chatId) {
      onDraftChange?.(overrides)
      return
    }
    saveMut.mutate({ chatId, values: overrides })
  }

  const body = (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Values for this conversation. Unchanged fields keep the stack default.
      </p>
      {variables.map((variable) => {
        const value = draftForRender[variable.name] ?? variable.default
        return (
          <div key={variable.name} className="grid gap-1">
            <Label className="text-[11px]" htmlFor={`var-${variable.name}`}>
              {variable.name}
            </Label>
            {variable.description ? (
              <p className="text-xs text-muted-foreground">
                {variable.description}
              </p>
            ) : null}
            {variable.type === "boolean" ? (
              <div className="flex items-center gap-2">
                <Switch
                  id={`var-${variable.name}`}
                  size="sm"
                  checked={Boolean(value)}
                  disabled={saveMut.isPending}
                  onCheckedChange={(checked) =>
                    commit({ ...draftForRender, [variable.name]: checked })
                  }
                />
                <span className="text-sm text-muted-foreground">
                  {value ? "On" : "Off"}
                </span>
              </div>
            ) : (
              <Input
                id={`var-${variable.name}`}
                className="h-8"
                value={typeof value === "string" ? value : ""}
                disabled={saveMut.isPending}
                onChange={(event) =>
                  setDraft({
                    ...draftForRender,
                    [variable.name]: event.target.value,
                  })
                }
                onBlur={() => {
                  if (draftForRender[variable.name] === resolved[variable.name])
                    return
                  commit(draftForRender)
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )

  const triggerLabel =
    variables.length === 1 ? variables[0]!.name : `${variables.length} vars`

  if (mdUp) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="max-w-[min(9rem,24vw)] min-w-0 truncate"
              title="Chat variables"
              aria-label="Chat variables"
            />
          }
        >
          <span className="truncate">{triggerLabel}</span>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-[min(20rem,calc(100vw-2rem))] gap-3 p-3"
        >
          {body}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="max-w-[7rem] min-w-0 truncate px-2"
        onClick={() => setOpen(true)}
        title="Chat variables"
        aria-label="Chat variables"
      >
        <span className="truncate">Vars</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Chat variables</DialogTitle>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
    </>
  )
}
