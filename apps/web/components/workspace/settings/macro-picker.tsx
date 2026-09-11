"use client"

import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import {
  builtInMacroDefinitions,
  createMacroRegistry,
  groupedMacroPickerEntries,
  MACRO_LOGIC_GROUP_LABEL,
  macroLogicPickerEntries,
  macroPickerPreview,
  type MacroContext,
  type MacroDefinition,
} from "@/lib/prompt-macros"

export function MacroPicker({
  macros = builtInMacroDefinitions,
  variables = [],
  catalogContext,
  onInsert,
  blockSnippets = false,
  disabled = false,
  "aria-label": ariaLabel = "Insert prompt macro",
}: {
  macros?: readonly MacroDefinition[]
  variables?: ReadonlyArray<{ name: string; summary?: string }>
  catalogContext: MacroContext | null
  onInsert: (snippet: string) => void
  /** Multiline {{if}} scaffolding for prompt bodies. */
  blockSnippets?: boolean
  disabled?: boolean
  "aria-label"?: string
}) {
  const registry = useMemo(() => createMacroRegistry(macros), [macros])
  const groups = useMemo(() => groupedMacroPickerEntries(macros), [macros])
  const namedVariables = useMemo(
    () => variables.filter((variable) => variable.name.trim()),
    [variables]
  )
  const logicEntries = useMemo(
    () => macroLogicPickerEntries(namedVariables, { block: blockSnippets }),
    [namedVariables, blockSnippets]
  )

  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto shrink-0"
            aria-label={ariaLabel}
            disabled={disabled}
          />
        }
      >
        Macros
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(22rem,calc(100vw-2rem))] gap-1 p-2"
      >
        <div className="flex max-h-[min(22rem,50vh)] flex-col overflow-y-auto">
          {namedVariables.length ? (
            <div>
              <p className="px-2 pt-0.5 pb-0.5 text-[11px] tracking-wide text-muted-foreground/80 uppercase">
                Variables
              </p>
              <ul className="flex flex-col">
                {namedVariables.map((variable) => {
                  const snippet = `{{vars.${variable.name}}}`
                  const preview =
                    catalogContext?.variables?.[variable.name] ?? snippet
                  return (
                    <li key={`vars:${variable.name}`}>
                      <button
                        type="button"
                        title={variable.summary ?? variable.name}
                        className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted/70"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onInsert(snippet)}
                      >
                        <span className="font-mono text-[11px]">
                          {variable.name}
                        </span>
                        <span className="min-w-0 truncate text-xs text-muted-foreground">
                          {String(preview)}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}
          <div>
            <p
              className={cn(
                "px-2 pb-0.5 text-[11px] tracking-wide text-muted-foreground/80 uppercase",
                namedVariables.length ? "pt-2" : "pt-0.5"
              )}
            >
              {MACRO_LOGIC_GROUP_LABEL}
            </p>
            <ul className="flex flex-col">
              {logicEntries.map((entry) => (
                <li key={`logic:${entry.name}`}>
                  <button
                    type="button"
                    title={entry.summary}
                    className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted/70"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onInsert(entry.snippet)}
                  >
                    <span className="font-mono text-[11px]">{entry.name}</span>
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      {entry.preview}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {groups.map((group) => (
            <div key={group.id}>
              <p className="px-2 pt-2 pb-0.5 text-[11px] tracking-wide text-muted-foreground/80 uppercase">
                {group.label}
              </p>
              <ul className="flex flex-col">
                {group.entries.map((entry) => (
                  <li key={`${group.id}:${entry.name}`}>
                    <button
                      type="button"
                      title={entry.summary}
                      className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted/70"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onInsert(entry.snippet)}
                    >
                      <span className="font-mono text-[11px]">
                        {entry.name}
                      </span>
                      <span className="min-w-0 truncate text-xs text-muted-foreground">
                        {macroPickerPreview(entry, catalogContext, registry)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
