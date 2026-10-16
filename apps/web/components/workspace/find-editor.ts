import { StateEffect, StateField, EditorSelection } from "@codemirror/state"
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
} from "@codemirror/view"
import { findOccurrences } from "@/lib/conversation-search"
import {
  transcriptScrollport,
  navigateTranscriptElement,
} from "./transcript-navigation"

const transcriptReveals = new WeakSet<EditorView>()

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
  EditorView.scrollHandler.of((view, range) => {
    if (!transcriptReveals.delete(view)) return false
    // CodeMirror's default reveal scrolls every ancestor. For a linear find,
    // scroll the editor locally and delegate the outer movement to its owner.
    view.requestMeasure({
      key: transcriptReveals,
      read: () => {
        const line = view.lineBlockAt(range.head)
        return (
          view.coordsAtPos(range.head) ?? {
            top: view.documentTop + line.top,
            bottom: view.documentTop + line.bottom,
          }
        )
      },
      write: (measured) => {
        let bounds = measured
        const outer = transcriptScrollport(view.dom)!
        for (
          let port = view.scrollDOM;
          port !== outer;
          port = port.parentElement!
        ) {
          if (!/auto|scroll/.test(getComputedStyle(port).overflowY)) continue
          const before = port.scrollTop
          port.scrollTop +=
            (bounds.top + bounds.bottom) / 2 -
            (port.getBoundingClientRect().top + port.clientHeight / 2)
          const moved = port.scrollTop - before
          bounds = { top: bounds.top - moved, bottom: bounds.bottom - moved }
        }
        navigateTranscriptElement(view.dom, "nearest", "auto", bounds)
      },
    })
    return true
  }),
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
type ScrollAnchor = { element: HTMLElement; top: number; left: number }

function scrollAnchors(start: HTMLElement) {
  const anchors: ScrollAnchor[] = []
  const outer = transcriptScrollport(start)
  for (
    let node: HTMLElement | null = start;
    node && node !== outer;
    node = node.parentElement
  )
    anchors.push({
      element: node,
      top: node.scrollTop,
      left: node.scrollLeft,
    })
  return anchors
}

function applyScrollAnchors(anchors: readonly ScrollAnchor[]) {
  for (const anchor of anchors) {
    if (!anchor.element.isConnected) continue
    if (anchor.element.scrollTop !== anchor.top)
      anchor.element.scrollTop = anchor.top
    if (anchor.element.scrollLeft !== anchor.left)
      anchor.element.scrollLeft = anchor.left
  }
}

/** Decoration rewrites can scroll the caret into view. Hold the prior offsets. */
const heldEditorScroll: ScrollAnchor[][] = []
let heldScrollVersion = 0
let heldScrollInputController: AbortController | null = null

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
  const anchors = scrollAnchors(view.scrollDOM)
  painted.set(view, { doc: view.state.doc, starts, length, current })
  view.dispatch({ effects: setMatches.of({ starts, length, current }) })
  view.dom.toggleAttribute("data-find-editor-current", current >= 0)
  applyScrollAnchors(anchors)
  heldEditorScroll.push(anchors)
}

/**
 * Put held editor scroll back after the browser's post-layout caret scroll.
 * Skip this when a deliberate reveal owns the position.
 */
export function settleHeldEditorScroll() {
  const pending = heldEditorScroll.splice(0)
  if (pending.length === 0) return
  discardHeldEditorScroll()
  const version = heldScrollVersion
  const controller = new AbortController()
  heldScrollInputController = controller
  for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
    document.addEventListener(event, discardHeldEditorScroll, {
      capture: true,
      passive: true,
      signal: controller.signal,
    })
  const restore = () => {
    if (version !== heldScrollVersion) return
    for (const anchors of pending) applyScrollAnchors(anchors)
  }
  requestAnimationFrame(() => {
    restore()
    requestAnimationFrame(() => {
      restore()
      controller.abort()
      if (heldScrollInputController === controller)
        heldScrollInputController = null
    })
  })
}

export function discardHeldEditorScroll() {
  heldScrollVersion++
  heldScrollInputController?.abort()
  heldScrollInputController = null
  heldEditorScroll.length = 0
}

export function clearEditorFind() {
  for (const view of editors.values()) paintEditorFind(view, [], 0, -1)
  settleHeldEditorScroll()
}
export type EditorFindTarget = { view: EditorView; start: number; end: number }
export function revealEditorFind({ view, start, end }: EditorFindTarget) {
  if (transcriptScrollport(view.dom)) transcriptReveals.add(view)
  view.dispatch({
    effects: EditorView.scrollIntoView(EditorSelection.range(start, end), {
      y: "center",
    }),
  })
}
