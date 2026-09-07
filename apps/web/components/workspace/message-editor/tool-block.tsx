"use client"

import { useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  questionInputDraft,
  questionInputSchema,
} from "@/lib/agent/tools/question-shared"
import type { ToolInvocationPart, ToolInvocationState } from "@/lib/types"
import { QuestionInputEditor } from "../tools/question-tool"

const TOOL_STATES: ToolInvocationState[] = [
  "output-available",
  "output-error",
]

export type ToolDraftCommit = { valid: boolean; commit: () => void }

function prettyJson(value: unknown): string {
  if (value === undefined) return ""
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function parseJsonValue(raw: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch {
    return { ok: false }
  }
}

export function ToolBlockEditor({
  part,
  disabled = false,
  onChange,
  onValidityChange,
  onRegisterCommit,
}: {
  part: ToolInvocationPart
  disabled?: boolean
  onChange: (part: ToolInvocationPart) => void
  onValidityChange?: (valid: boolean) => void
  onRegisterCommit?: (
    commit: () => ToolDraftCommit
  ) => void | (() => void)
}) {
  const parsedQuestion = questionInputSchema.safeParse(part.input)
  const [view, setView] = useState<"json" | "widget">(
    part.toolName === "question" && parsedQuestion.success ? "widget" : "json"
  )
  const widgetAvailable =
    part.toolName === "question" &&
    (parsedQuestion.success || view === "widget")
  const [inputText, setInputText] = useState(() => prettyJson(part.input))
  const [outputText, setOutputText] = useState(() => prettyJson(part.output))
  const [inputError, setInputError] = useState(false)
  const [outputError, setOutputError] = useState(false)

  useEffect(() => {
    setInputText(prettyJson(part.input))
    setInputError(false)
  }, [part.input])
  useEffect(() => {
    setOutputText(prettyJson(part.output))
    setOutputError(false)
  }, [part.output])

  const valid = !inputError && !outputError
  const validityCallback = useRef(onValidityChange)
  useEffect(() => {
    validityCallback.current = onValidityChange
  }, [onValidityChange])
  useEffect(() => {
    validityCallback.current?.(valid)
  }, [valid])
  useEffect(() => () => validityCallback.current?.(true), [])

  const questionValue = questionInputDraft(part.input)
  const showWidget = view === "widget" && widgetAvailable

  const prepareDrafts = (): ToolDraftCommit => {
    if (showWidget) return { valid: true, commit: () => {} }
    const input = parseJsonValue(inputText)
    const output = parseJsonValue(outputText)
    setInputError(!input.ok)
    setOutputError(!output.ok)
    if (!input.ok || !output.ok) return { valid: false, commit: () => {} }
    return {
      valid: true,
      commit: () =>
        onChange({
          ...part,
          input: input.value === undefined ? {} : input.value,
          output: output.value,
        }),
    }
  }
  const commitRef = useRef(prepareDrafts)
  useEffect(() => {
    commitRef.current = prepareDrafts
  })
  useEffect(() => {
    return onRegisterCommit?.(() => commitRef.current())
    // Registration is keyed by the stable block key in the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commitJson = (
    field: "input" | "output",
    raw: string
  ) => {
    const parsed = parseJsonValue(raw)
    if (!parsed.ok) {
      if (field === "input") setInputError(true)
      else setOutputError(true)
      return
    }
    if (field === "input") {
      setInputError(false)
      onChange({
        ...part,
        input: parsed.value === undefined ? {} : parsed.value,
      })
      return
    }
    setOutputError(false)
    onChange({
      ...part,
      output: parsed.value,
    })
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Record</Badge>
        <span className="text-[11px] text-muted-foreground">
          Historical data — will not run
        </span>
        {part.toolName === "question" ? (
          <ToggleGroup
            value={[showWidget ? "widget" : "json"]}
            onValueChange={(next) => {
              const mode = next[0]
              if (mode === "json") setView("json")
              if (mode === "widget" && widgetAvailable) setView("widget")
            }}
            variant="outline"
            spacing={0}
            size="sm"
            className="ml-auto"
          >
            <ToggleGroupItem value="json" className="px-2 text-xs">
              JSON
            </ToggleGroupItem>
            <ToggleGroupItem
              value="widget"
              className="px-2 text-xs"
              disabled={!widgetAvailable}
            >
              Widget
            </ToggleGroupItem>
          </ToggleGroup>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Label className="grid gap-1 text-xs font-normal">
          Tool
          <Input
            value={part.toolName}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...part, toolName: event.target.value || "tool" })
            }
          />
        </Label>
        <Label className="grid gap-1 text-xs font-normal">
          State
          <Select
            value={part.state}
            onValueChange={(value) => {
              if (!value) return
              if (!TOOL_STATES.includes(value as ToolInvocationState)) return
              onChange({ ...part, state: value as ToolInvocationState })
            }}
            disabled={disabled}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TOOL_STATES.map((state) => (
                <SelectItem key={state} value={state}>
                  {state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>
      </div>
      {showWidget ? (
        <QuestionInputEditor
          value={questionValue}
          disabled={disabled}
          onChange={(input) => onChange({ ...part, input })}
        />
      ) : (
        <>
          <Label className="grid gap-1 text-xs font-normal">
            Input
            <Textarea
              className="min-h-24 font-mono text-xs"
              spellCheck={false}
              disabled={disabled}
              value={inputText}
              aria-invalid={inputError || undefined}
              onChange={(event) => {
                setInputText(event.target.value)
                setInputError(false)
              }}
              onBlur={(event) => commitJson("input", event.currentTarget.value)}
            />
            {inputError ? (
              <span className="text-destructive">Invalid JSON</span>
            ) : null}
          </Label>
          <Label className="grid gap-1 text-xs font-normal">
            Output
            <Textarea
              className="min-h-20 font-mono text-xs"
              spellCheck={false}
              disabled={disabled}
              value={outputText}
              aria-invalid={outputError || undefined}
              onChange={(event) => {
                setOutputText(event.target.value)
                setOutputError(false)
              }}
              onBlur={(event) =>
                commitJson("output", event.currentTarget.value)
              }
            />
            {outputError ? (
              <span className="text-destructive">Invalid JSON</span>
            ) : null}
          </Label>
          <Label className="grid gap-1 text-xs font-normal">
            Error
            <Input
              value={part.errorText ?? ""}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...part,
                  errorText: event.target.value || undefined,
                })
              }
            />
          </Label>
        </>
      )}
    </div>
  )
}
