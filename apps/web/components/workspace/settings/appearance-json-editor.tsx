"use client"

import { useMemo } from "react"
import type * as React from "react"
import type { Extension } from "@codemirror/state"
import { CodeEditor } from "@/components/ui/code-editor"
import { appearanceJsonExtensions } from "@/lib/appearance-json"
import { cn } from "@/lib/utils"

export function AppearanceJsonEditor({
  className,
  ...props
}: Omit<React.ComponentProps<typeof CodeEditor>, "extensions">) {
  const extensions = useMemo<Extension[]>(() => appearanceJsonExtensions(), [])
  return (
    <CodeEditor
      {...props}
      extensions={extensions}
      ariaLabel={props.ariaLabel ?? "Theme JSON"}
      className={cn(
        "rounded-none border-0 text-xs [&_.cm-content]:min-h-0 [&_.cm-content]:py-2",
        className
      )}
    />
  )
}
