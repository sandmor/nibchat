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
  macroPickerPreview,
  type MacroContext,
  type MacroDefinition,
} from "@/lib/prompt-macros"

export function MacroPicker({
  macros = builtInMacroDefinitions,
  catalogContext,
  onInsert,
  disabled = false,
  "aria-label": ariaLabel = "Insert prompt macro",
}: {
  macros?: readonly MacroDefinition[]
  catalogContext: MacroContext | null
  onInsert: (snippet: string) => void
  disabled?: boolean
  "aria-label"?: string
}) {
  const registry = useMemo(() => createMacroRegistry(macros), [macros])
  const groups = useMemo(() => groupedMacroPickerEntries(macros), [macros])

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
          {groups.map((group, groupIndex) => (
            <div key={group.id}>
              <p
                className={cn(
                  "px-2 pb-0.5 text-[11px] tracking-wide text-muted-foreground/80 uppercase",
                  groupIndex === 0 ? "pt-0.5" : "pt-2"
                )}
              >
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
