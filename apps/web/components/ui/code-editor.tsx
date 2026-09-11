"use client"

import * as React from "react"
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror"
import { EditorView, keymap } from "@codemirror/view"
import {
  HighlightStyle,
  bracketMatching,
  syntaxHighlighting,
} from "@codemirror/language"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { completionKeymap } from "@codemirror/autocomplete"
import { tags } from "@lezer/highlight"
import { EditorState, type ChangeSpec, type Extension } from "@codemirror/state"
import { cn } from "@/lib/utils"

export type CodeEditorHandle = {
  replaceSelection: (text: string) => void
}

type CodeEditorProps = {
  value: string
  onChange: (value: string) => void
  extensions?: Extension[]
  singleLine?: boolean
  disabled?: boolean
  placeholder?: string
  className?: string
  ariaLabel?: string
  ariaDescribedBy?: string
  ariaInvalid?: boolean
  onBlur?: () => void
  height?: string
}

// Apply cleanup as a sequential change so CodeMirror maps the selection and
// history through it, including paste, drop, and imperative snippet insertion.
const singleLineFilter = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged) return transaction
  const changes: ChangeSpec[] = []
  for (let line = 2; line <= transaction.newDoc.lines; line++) {
    const from = transaction.newDoc.line(line).from
    changes.push({ from: from - 1, to: from })
  }
  return changes.length
    ? [transaction, { changes, sequential: true }]
    : transaction
})

const editorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--foreground)",
    fontFamily: "inherit",
  },
  ".cm-content": { caretColor: "var(--foreground)" },
  ".cm-scroller": { fontFamily: "inherit", overflow: "auto" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--muted-foreground)",
    border: "none",
    paddingRight: "0.5rem",
  },
  ".cm-lintRange-error": {
    backgroundColor: "color-mix(in oklab, var(--danger) 16%, transparent)",
  },
  ".cm-lintRange-warning": {
    backgroundColor: "color-mix(in oklab, var(--ring) 18%, transparent)",
  },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--popover-border)",
    borderRadius: "0.5rem",
    overflow: "hidden",
    fontFamily: "inherit",
    boxShadow: "0 4px 12px rgb(0 0 0 / 12%)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "inherit",
    minWidth: "0",
  },
  ".cm-tooltip-autocomplete ul li": {
    padding: "0.25rem 0.5rem",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--button)",
    color: "var(--button-foreground)",
  },
  ".cm-completionDetail": { fontStyle: "normal", opacity: "0.8" },
  ".cm-completionMatchedText": { textDecoration: "underline" },
  ".cm-matchingBracket": {
    backgroundColor: "color-mix(in oklab, var(--ring) 20%, transparent)",
    color: "var(--foreground)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection":
    { backgroundColor: "color-mix(in oklab, var(--ring) 25%, transparent)" },
  "&.cm-focused": {
    outline: "none",
    boxShadow: "0 0 0 3px color-mix(in oklab, var(--ring) 50%, transparent)",
  },
})

const editorHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.punctuation, color: "var(--primary)" },
    {
      tag: [tags.brace, tags.squareBracket, tags.separator],
      color: "var(--primary)",
    },
    { tag: tags.propertyName, color: "var(--accent-foreground)" },
    { tag: tags.variableName, color: "var(--accent-foreground)" },
    { tag: tags.number, color: "var(--foreground)" },
    { tag: tags.string, color: "var(--foreground)" },
    { tag: tags.bool, color: "var(--muted-foreground)" },
    { tag: tags.null, color: "var(--muted-foreground)" },
    { tag: tags.operatorKeyword, color: "var(--muted-foreground)" },
  ])
)

export const CodeEditor = React.forwardRef<CodeEditorHandle, CodeEditorProps>(
  function CodeEditor(
    {
      value,
      onChange,
      extensions = [],
      singleLine = false,
      disabled = false,
      placeholder,
      className,
      ariaLabel,
      ariaDescribedBy,
      ariaInvalid,
      onBlur,
      height,
    },
    ref
  ) {
    const editorRef = React.useRef<ReactCodeMirrorRef>(null)
    React.useImperativeHandle(ref, () => ({
      replaceSelection: (text) => {
        const view = editorRef.current?.view
        if (!view) return
        view.dispatch({
          ...view.state.replaceSelection(text),
          userEvent: "input.complete",
        })
        view.focus()
      },
    }))
    const layout = React.useMemo<Extension[]>(
      () => [
        editorTheme,
        editorHighlight,
        bracketMatching(),
        history(),
        keymap.of([...historyKeymap, ...defaultKeymap, ...completionKeymap]),
        EditorView.contentAttributes.of({
          ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
          ...(ariaDescribedBy ? { "aria-describedby": ariaDescribedBy } : {}),
          ...(ariaInvalid ? { "aria-invalid": "true" } : {}),
        }),
        EditorView.lineWrapping,
        ...(singleLine
          ? [
              singleLineFilter,
              EditorView.contentAttributes.of({ "aria-multiline": "false" }),
              EditorView.domEventHandlers({
                keydown(event) {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    return true
                  }
                  return false
                },
              }),
            ]
          : []),
      ],
      [singleLine, ariaLabel, ariaDescribedBy, ariaInvalid]
    )
    return (
      <CodeMirror
        theme="none"
        ref={editorRef}
        value={singleLine ? value.replace(/[\r\n]/g, "") : value}
        onChange={onChange}
        extensions={[...layout, ...extensions]}
        editable={!disabled}
        basicSetup={false}
        placeholder={placeholder}
        onBlur={onBlur}
        height={height}
        className={cn(
          "w-full overflow-hidden rounded-xl border border-input-border bg-input/30 text-sm transition-colors focus-within:border-ring elevation-dark:bg-input [&_.cm-content]:min-h-20 [&_.cm-content]:px-3 [&_.cm-content]:py-3",
          disabled && "cursor-not-allowed opacity-50",
          singleLine &&
            "h-9 rounded-4xl [&_.cm-content]:min-h-0 [&_.cm-content]:px-3 [&_.cm-content]:py-1 [&_.cm-content]:whitespace-pre [&_.cm-scroller]:overflow-x-auto [&_.cm-scroller]:overflow-y-hidden",
          className
        )}
      />
    )
  }
)
