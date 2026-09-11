"use client"

import { useMemo, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { InformationCircleIcon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { type CodeEditorHandle } from "@/components/ui/code-editor"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TooltipProvider, WithTooltip } from "@/components/ui/tooltip"
import { previewHeaderEntry, isValidHttpHeader } from "@/lib/config-entries"
import {
  builtInMacroDefinitions,
  catalogMacroContext,
  normalizeTimeZone,
} from "@/lib/prompt-macros"
import { useBrowserTimeZone } from "../hooks"
import { MacroPicker } from "./macro-picker"
import { MacroEditor } from "./macro-editor"

export type KvEntry = {
  name: string
  value: string
}

const ENV_TEMPLATE_HELP =
  "Embed ${ENV_NAME} in a value to resolve it from the server environment at connect time."

const HEADER_TEMPLATE_HELP =
  "Embed ${ENV_NAME} for server environment values, or prompt macros such as {{date}} and {{chatId}}. Macros resolve when a request is sent."

export function KvEntriesEditor({
  label,
  entries,
  onChange,
  namePlaceholder = "Name",
  valuePlaceholder = "Value or ${ENV_NAME}",
  addLabel = "Add row",
  disabled = false,
  macros = false,
}: {
  label: string
  entries: KvEntry[]
  onChange: (entries: KvEntry[]) => void
  namePlaceholder?: string
  valuePlaceholder?: string
  addLabel?: string
  disabled?: boolean
  /** Header values can insert and preview prompt macros. */
  macros?: boolean
}) {
  const help = macros ? HEADER_TEMPLATE_HELP : ENV_TEMPLATE_HELP
  return (
    <div className="space-y-2 sm:col-span-2">
      <div className="flex items-center gap-1.5">
        <Label className="mb-0">{label}</Label>
        <TooltipProvider delay={200}>
          <WithTooltip side="top" label={help}>
            <button
              type="button"
              className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
              aria-label={`About ${label.toLowerCase()} environment templates`}
            >
              <HugeiconsIcon
                icon={InformationCircleIcon}
                className="size-3.5"
                strokeWidth={2}
              />
            </button>
          </WithTooltip>
        </TooltipProvider>
      </div>
      <div className="space-y-2">
        {entries.map((entry, index) =>
          macros ? (
            <HeaderEntryRow
              key={index}
              label={label}
              index={index}
              entry={entry}
              entries={entries}
              onChange={onChange}
              namePlaceholder={namePlaceholder}
              valuePlaceholder={valuePlaceholder}
              disabled={disabled}
            />
          ) : (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <Input
                className="min-w-[8rem] flex-1"
                value={entry.name}
                onChange={(event) => {
                  const next = [...entries]
                  next[index] = { ...entry, name: event.target.value }
                  onChange(next)
                }}
                placeholder={namePlaceholder}
                disabled={disabled}
                aria-label={`${label} name ${index + 1}`}
              />
              <Input
                className="min-w-[12rem] flex-[2]"
                value={entry.value}
                onChange={(event) => {
                  const next = [...entries]
                  next[index] = { ...entry, value: event.target.value }
                  onChange(next)
                }}
                placeholder={valuePlaceholder}
                autoComplete="off"
                disabled={disabled}
                aria-label={`${label} value ${index + 1}`}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onChange(entries.filter((_, i) => i !== index))}
                disabled={disabled}
              >
                Remove
              </Button>
            </div>
          )
        )}
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => onChange([...entries, { name: "", value: "" }])}
        disabled={disabled}
      >
        {addLabel}
      </Button>
    </div>
  )
}

function HeaderEntryRow({
  label,
  index,
  entry,
  entries,
  onChange,
  namePlaceholder,
  valuePlaceholder,
  disabled,
}: {
  label: string
  index: number
  entry: KvEntry
  entries: KvEntry[]
  onChange: (entries: KvEntry[]) => void
  namePlaceholder: string
  valuePlaceholder: string
  disabled: boolean
}) {
  const valueRef = useRef<CodeEditorHandle>(null)
  const [headerInvalid, setHeaderInvalid] = useState(false)
  const browserTimeZone = useBrowserTimeZone()
  const timeZone = browserTimeZone ? normalizeTimeZone(browserTimeZone) : null
  const catalogContext = useMemo(
    () => (timeZone ? catalogMacroContext(timeZone) : null),
    [timeZone]
  )
  const preview = useMemo(
    () =>
      catalogContext && entry.value
        ? previewHeaderEntry(entry, catalogContext)
        : null,
    [catalogContext, entry]
  )

  function patch(nextEntry: KvEntry) {
    const next = [...entries]
    next[index] = nextEntry
    onChange(next)
  }

  function validateHeader() {
    if (!entry.name && !entry.value) {
      setHeaderInvalid(false)
      return
    }
    const expanded = preview?.expanded ?? entry.value
    setHeaderInvalid(
      Boolean(entry.name) && !isValidHttpHeader(entry.name, expanded)
    )
  }

  const describedBy = [
    preview?.expanded && preview.expanded !== entry.value
      ? `header-preview-${index}`
      : null,
    preview?.omittedWithoutChat ? `header-chat-${index}` : null,
    preview?.unresolved ? `header-unresolved-${index}` : null,
    headerInvalid ? `header-invalid-${index}` : null,
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="min-w-[8rem] flex-1"
          value={entry.name}
          onChange={(event) => {
            setHeaderInvalid(false)
            patch({ ...entry, name: event.target.value })
          }}
          onBlur={validateHeader}
          placeholder={namePlaceholder}
          disabled={disabled}
          aria-label={`${label} name ${index + 1}`}
          aria-invalid={headerInvalid ? true : undefined}
          aria-describedby={describedBy || undefined}
        />
        <MacroEditor
          editorRef={valueRef}
          className="min-w-[12rem] flex-[2]"
          value={entry.value}
          onChange={(value) => {
            setHeaderInvalid(false)
            patch({ ...entry, value })
          }}
          onBlur={validateHeader}
          placeholder={valuePlaceholder}
          disabled={disabled}
          singleLine
          macros={builtInMacroDefinitions}
          ariaLabel={`${label} value ${index + 1}`}
          ariaInvalid={headerInvalid ? true : undefined}
          ariaDescribedBy={describedBy || undefined}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onChange(entries.filter((_, i) => i !== index))}
          disabled={disabled}
        >
          Remove
        </Button>
      </div>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          {preview && preview.expanded !== entry.value ? (
            <p
              id={`header-preview-${index}`}
              className="line-clamp-2 text-xs text-muted-foreground"
            >
              <span className="mr-1 text-[11px] tracking-wide text-muted-foreground/80 uppercase">
                Sends as
              </span>
              {preview.expanded}
            </p>
          ) : null}
          {preview?.omittedWithoutChat ? (
            <p
              id={`header-chat-${index}`}
              className="text-xs text-muted-foreground"
            >
              Sent with chat requests; omitted when listing models or testing a
              connection.
            </p>
          ) : null}
          {preview?.unresolved ? (
            <p
              id={`header-unresolved-${index}`}
              className="text-xs text-destructive"
            >
              This value will not be sent.
            </p>
          ) : null}
          {headerInvalid ? (
            <p
              id={`header-invalid-${index}`}
              className="text-xs text-destructive"
            >
              Invalid header name or value.
            </p>
          ) : null}
        </div>
        <MacroPicker
          catalogContext={catalogContext}
          onInsert={(snippet) => valueRef.current?.replaceSelection(snippet)}
          disabled={disabled}
          aria-label={`Insert prompt macro into ${label.toLowerCase()} value ${index + 1}`}
        />
      </div>
    </div>
  )
}

export function StringListEditor({
  label,
  values,
  onChange,
  placeholder = "argument",
  addLabel = "Add argument",
}: {
  label: string
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  addLabel?: string
}) {
  return (
    <div className="space-y-2 sm:col-span-2">
      <Label>{label}</Label>
      <div className="space-y-2">
        {values.map((value, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={value}
              onChange={(event) => {
                const next = [...values]
                next[index] = event.target.value
                onChange(next)
              }}
              placeholder={placeholder}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange(values.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => onChange([...values, ""])}
      >
        {addLabel}
      </Button>
    </div>
  )
}
