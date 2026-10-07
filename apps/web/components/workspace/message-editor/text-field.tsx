"use client"

import { useMemo } from "react"
import CodeMirror from "@uiw/react-codemirror"
import { EditorView, keymap } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { findEditorExtensions } from "../find-editor"
import { editorFieldMinHeight } from "./layout"

export function MessageTextField({
  value,
  onChange,
  disabled,
  autoFocus,
  ariaLabel,
  className,
  skipFind = false,
  fieldKey,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  autoFocus?: boolean
  ariaLabel: string
  className?: string
  skipFind?: boolean
  fieldKey: string
}) {
  const extensions = useMemo(
    () => [
      history(),
      keymap.of([...historyKeymap, ...defaultKeymap]),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        "aria-label": ariaLabel,
        spellcheck: "true",
        autocorrect: "on",
        autocapitalize: "sentences",
        writingsuggestions: "true",
      }),
      EditorView.theme({
        "&": {
          backgroundColor: "transparent",
          color: "inherit",
          fontSize: "inherit",
        },
        "&.cm-focused": { outline: "none" },
        ".cm-scroller": {
          fontFamily: "inherit",
          lineHeight: "inherit",
          // PartsEditor caps and scrolls the whole block list. Uncapped
          // fields must let wheel input reach that outer scroll container.
          overflow: "visible",
          overscrollBehavior: "auto",
        },
        ".cm-content": {
          padding: "0",
          caretColor: "var(--foreground)",
          // Keep the entire minimum-height area editable, including empty drafts.
          minHeight: editorFieldMinHeight({
            purpose: "edit",
            surface: "inline",
          }),
        },
        ".cm-line": { padding: "0" },
        ".cm-placeholder": { color: "var(--muted-foreground)" },
        ".cm-cursor": { borderLeftColor: "var(--foreground)" },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection":
          {
            backgroundColor:
              "color-mix(in oklab, var(--ring) 25%, transparent)",
          },
      }),
      ...findEditorExtensions,
    ],
    [ariaLabel]
  )
  return (
    <div
      data-find-field={fieldKey}
      data-find-editor-key={fieldKey}
      data-find-skip=""
      data-editor-find-skip={skipFind ? "" : undefined}
      className={className}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        editable={!disabled}
        readOnly={disabled}
        autoFocus={autoFocus}
        theme="none"
        basicSetup={false}
        indentWithTab={false}
        extensions={extensions}
      />
    </div>
  )
}
