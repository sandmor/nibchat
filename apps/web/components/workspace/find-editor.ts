import { StateEffect, StateField, EditorSelection } from "@codemirror/state"
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
} from "@codemirror/view"
import { findOccurrences } from "@/lib/conversation-search"

const setMatches = StateEffect.define<{
  starts: number[]
  length: number
  current: number
}>()
const matches = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (!effect.is(setMatches)) continue
      const { starts, length, current } = effect.value
      value = Decoration.set(
        starts.map((start, index) =>
          Decoration.mark({
            class: index === current ? "cm-find-current" : "cm-find-match",
          }).range(start, start + length)
        )
      )
    }
    return value
  },
  provide: (field) => EditorView.decorations.from(field),
})

export const findEditorExtensions = [
  matches,
  ViewPlugin.fromClass(
    class {
      private unregister: () => void
      constructor(view: EditorView) {
        this.unregister = registerFindEditor(view)
      }
      update(update: import("@codemirror/view").ViewUpdate) {
        if (update.docChanged)
          update.view.dom.dispatchEvent(
            new CustomEvent("conversation-find-editor-update", {
              bubbles: true,
            })
          )
      }
      destroy() {
        this.unregister()
      }
    }
  ),
  EditorView.theme({
    ".cm-find-match": { backgroundColor: "var(--conversation-find-match)" },
    ".cm-find-current": { backgroundColor: "var(--conversation-find-current)" },
  }),
]

const editors = new Map<HTMLElement, EditorView>()
const painted = new WeakMap<
  EditorView,
  {
    doc: EditorView["state"]["doc"]
    starts: number[]
    length: number
    current: number
  }
>()
function registerFindEditor(view: EditorView) {
  editors.set(view.dom, view)
  return () => {
    editors.delete(view.dom)
  }
}
export function mountedFindEditors(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(".cm-editor")].flatMap(
    (element) => {
      const view = editors.get(element)
      return view && !element.closest("[data-editor-find-skip]") ? [view] : []
    }
  )
}
const occurrences = new WeakMap<
  EditorView,
  { doc: EditorView["state"]["doc"]; query: string; starts: number[] }
>()
export function editorFindStarts(view: EditorView, query: string) {
  const cached = occurrences.get(view)
  if (cached?.doc === view.state.doc && cached.query === query)
    return cached.starts
  const starts = findOccurrences(view.state.doc.toString(), query)
  occurrences.set(view, { doc: view.state.doc, query, starts })
  return starts
}
export function paintEditorFind(
  view: EditorView,
  starts: number[],
  length: number,
  current: number
) {
  const previous = painted.get(view)
  if (
    previous?.doc === view.state.doc &&
    previous.length === length &&
    previous.current === current &&
    previous.starts.length === starts.length &&
    starts.every((start, index) => start === previous.starts[index])
  )
    return
  painted.set(view, { doc: view.state.doc, starts, length, current })
  view.dispatch({ effects: setMatches.of({ starts, length, current }) })
  view.dom.toggleAttribute("data-find-editor-current", current >= 0)
}
export function clearEditorFind() {
  for (const view of editors.values()) paintEditorFind(view, [], 0, -1)
}
export type EditorFindTarget = { view: EditorView; start: number; end: number }
export function revealEditorFind({ view, start, end }: EditorFindTarget) {
  view.dispatch({
    effects: EditorView.scrollIntoView(EditorSelection.range(start, end), {
      y: "center",
    }),
  })
}
