"use client"

import { useMemo } from "react"
import type * as React from "react"
import {
  autocompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete"
import { EditorView } from "@codemirror/view"
import { LRLanguage, LanguageSupport } from "@codemirror/language"
import { NodeProp } from "@lezer/common"
import { styleTags, tags } from "@lezer/highlight"
import type { EditorState, Extension } from "@codemirror/state"
import { parser } from "@/lib/macro-language/parser"
import type { MacroDefinition } from "@/lib/prompt-macros"
import { CodeEditor, type CodeEditorHandle } from "@/components/ui/code-editor"

const macroLanguage = LRLanguage.define({
  parser: parser.configure({
    props: [
      NodeProp.closedBy.add({ Open: ["Close"] }),
      NodeProp.openedBy.add({ Close: ["Open"] }),
      styleTags({
        "Open Close": tags.punctuation,
        Name: tags.variableName,
        Number: tags.number,
        String: tags.string,
        Operator: tags.operatorKeyword,
      }),
    ],
  }),
})

const MAX_CONTEXT_LENGTH = 4096
const IDENTIFIER = /[A-Za-z0-9_]/

type MacroCompletionContext =
  | { kind: "expression"; from: number; to: number }
  | { kind: "variable"; from: number; to: number }

/** Finds an unfinished macro nearby without copying the whole document. */
export function macroCompletionContext(
  state: EditorState,
  pos: number
): MacroCompletionContext | null {
  const start = Math.max(0, pos - MAX_CONTEXT_LENGTH)
  const source = state.sliceDoc(start, pos)
  let open = -1
  let quote: string | null = null
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!
    if (quote) {
      if (char === "\\") index++
      else if (char === quote) quote = null
      continue
    }
    if (open >= 0 && (char === '"' || char === "'")) quote = char
    else if (char === "{" && source[index + 1] === "{") {
      open = start + index
      index++
    } else if (char === "}" && source[index + 1] === "}") {
      open = -1
      index++
    }
  }
  if (open < 0 || quote) return null

  let from = pos
  while (from > open + 2 && IDENTIFIER.test(state.sliceDoc(from - 1, from)))
    from--
  let to = pos
  while (to < state.doc.length && IDENTIFIER.test(state.sliceDoc(to, to + 1)))
    to++
  const expression = state.sliceDoc(open + 2, pos)
  return /\bvars\.([A-Za-z0-9_]*)$/.test(expression)
    ? { kind: "variable", from, to }
    : { kind: "expression", from, to }
}

function expressionOptions(macros: readonly MacroDefinition[]): Completion[] {
  return [
    {
      label: "vars",
      detail: "Prompt-stack variables",
      apply: (view, _completion, from, to) => {
        view.dispatch({
          changes: { from, to, insert: "vars." },
          selection: { anchor: from + 5 },
          userEvent: "input.complete",
        })
        requestAnimationFrame(() => startCompletion(view))
      },
    },
    { label: "true", detail: "Boolean" },
    { label: "false", detail: "Boolean" },
    { label: "if", detail: "Conditional block", apply: "if " },
    ...macros.map((macro) => ({
      label: macro.name,
      detail: macro.summary,
      // Picker snippets include macro delimiters. Existing macro editors need
      // only the expression content, never a nested {{…}} pair.
      apply: (macro.snippet ?? `{{${macro.name}}}`)
        .replace(/^\{\{/, "")
        .replace(/\}\}$/, ""),
    })),
  ]
}

function completionSource(
  macros: readonly MacroDefinition[],
  variables: readonly { name: string; summary?: string }[]
) {
  const namedVariables = variables.filter(
    (variable, index, all) =>
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.name) &&
      all.findIndex((candidate) => candidate.name === variable.name) === index
  )
  return (context: CompletionContext) => {
    const position = macroCompletionContext(context.state, context.pos)
    if (!position) return null
    const options: Completion[] =
      position.kind === "variable"
        ? namedVariables.map((variable) => ({
            label: variable.name,
            detail: variable.summary,
          }))
        : expressionOptions(macros)
    if (!options.length) return null
    return {
      from: position.from,
      to: position.to,
      options,
      validFor: /^[A-Za-z_][A-Za-z0-9_]*$/,
    }
  }
}

export function MacroEditor({
  editorRef,
  macros,
  variables = [],
  ...props
}: Omit<React.ComponentProps<typeof CodeEditor>, "extensions" | "ref"> & {
  editorRef?: React.Ref<CodeEditorHandle>
  macros: readonly MacroDefinition[]
  variables?: readonly { name: string; summary?: string }[]
}) {
  const extensions = useMemo<Extension[]>(
    () => [
      new LanguageSupport(macroLanguage),
      autocompletion({
        icons: false,
        override: [completionSource(macros, variables)],
      }),
      EditorView.updateListener.of((update) => {
        if (
          !update.docChanged ||
          update.transactions.some(
            (transaction) => !transaction.isUserEvent("input")
          )
        )
          return
        const position = macroCompletionContext(
          update.state,
          update.state.selection.main.head
        )
        if (position) startCompletion(update.view)
      }),
    ],
    [macros, variables]
  )
  return <CodeEditor ref={editorRef} extensions={extensions} {...props} />
}
