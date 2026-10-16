import { navigateTranscriptElement } from "./transcript-navigation"

import {
  mountedFindEditors,
  editorFindStarts,
  paintEditorFind,
  clearEditorFind,
  revealEditorFind,
  type EditorFindTarget,
} from "./find-editor"
import { findOccurrences, normalizeQuery } from "@/lib/conversation-search"

const SKIP_SELECTOR =
  ".markdown-content-reasoning,.katex,.katex-display,[data-find-skip]"

export const FIND_HIGHLIGHT = "conversation-find"
export const FIND_HIGHLIGHT_CURRENT = "conversation-find-current"
const FIND_HIGHLIGHT_STYLE_ID = "conversation-find-highlight-styles"

function highlightSelector(name: string) {
  return `:${":"}highlight(${name})`
}

/**
 * Tailwind v4 @source-scans ts/tsx and inlines CSS-looking template strings
 * into globals.css. LightningCSS then rejects the highlight pseudo-element.
 * Assemble the stylesheet at runtime so no scanned file contains that rule.
 */
export function ensureFindHighlightStyles() {
  if (typeof document === "undefined") return
  if (document.getElementById(FIND_HIGHLIGHT_STYLE_ID)) return
  const style = document.createElement("style")
  style.id = FIND_HIGHLIGHT_STYLE_ID
  style.textContent = `${highlightSelector(FIND_HIGHLIGHT)} {
  background-color: var(--conversation-find-match);
  color: inherit;
}
${highlightSelector(FIND_HIGHLIGHT_CURRENT)} {
  background-color: var(--conversation-find-current);
  color: inherit;
}
`
  document.head.appendChild(style)
}

function shouldSkip(node: Node) {
  const element = node instanceof Element ? node : node.parentElement
  return Boolean(element?.closest(SKIP_SELECTOR))
}

function collectTextNodes(root: HTMLElement): Text[] {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT
      if (shouldSkip(node)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let current = walker.nextNode()
  while (current) {
    nodes.push(current as Text)
    current = walker.nextNode()
  }
  return nodes
}

type TextSpan = { node: Text; start: number; length: number }

function collectTextSpans(root: HTMLElement): {
  spans: TextSpan[]
  hay: string
} {
  const spans: TextSpan[] = []
  let hay = ""
  for (const node of collectTextNodes(root)) {
    const value = node.nodeValue
    if (!value) continue
    spans.push({ node, start: hay.length, length: value.length })
    hay += value
  }
  return { spans, hay }
}

function offsetToPoint(
  spans: readonly TextSpan[],
  offset: number,
  hayLength: number
): { node: Text; offset: number } | null {
  if (spans.length === 0) return null
  if (offset >= hayLength) {
    const last = spans[spans.length - 1]!
    return { node: last.node, offset: last.length }
  }
  for (const span of spans) {
    if (offset < span.start + span.length) {
      return { node: span.node, offset: offset - span.start }
    }
  }
  const last = spans[spans.length - 1]!
  return { node: last.node, offset: last.length }
}

function highlightRegistry() {
  const css = globalThis.CSS as typeof CSS & {
    highlights?: {
      set: (name: string, highlight: Highlight) => void
      delete: (name: string) => boolean
    }
  }
  return css?.highlights ?? null
}

/** Visible matches as live Ranges. Does not mutate the DOM. */
export function collectFindRanges(
  root: HTMLElement,
  query: string
): { ranges: Range[] } {
  const needle = normalizeQuery(query)
  const ranges: Range[] = []
  if (!needle) return { ranges }

  const { spans, hay } = collectTextSpans(root)
  if (!hay) return { ranges }

  for (const start of findOccurrences(hay, needle)) {
    const end = start + needle.length
    const from = offsetToPoint(spans, start, hay.length)
    const to = offsetToPoint(spans, end, hay.length)
    if (!from || !to) continue
    const range = document.createRange()
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
    ranges.push(range)
  }
  return { ranges }
}

/** Map nth find-text hit onto DOM ranges, or flash when the counts disagree. */
export function resolveCurrentFindRange(
  ranges: readonly Range[],
  currentIndex: number,
  expectedCount: number
): { current: Range | null; flash: boolean } {
  if (currentIndex < 0) return { current: null, flash: false }
  if (ranges.length !== expectedCount) return { current: null, flash: true }
  const current = ranges[currentIndex] ?? null
  return { current, flash: !current }
}

export function publishFindHighlights(matches: Range[], current: Range | null) {
  ensureFindHighlightStyles()
  const highlights = highlightRegistry()
  if (!highlights || typeof Highlight !== "function") return
  if (matches.length === 0) highlights.delete(FIND_HIGHLIGHT)
  else highlights.set(FIND_HIGHLIGHT, new Highlight(...matches))
  if (current) highlights.set(FIND_HIGHLIGHT_CURRENT, new Highlight(current))
  else highlights.delete(FIND_HIGHLIGHT_CURRENT)
}

export function clearFindHighlights() {
  clearEditorFind()
  const highlights = highlightRegistry()
  if (!highlights) return
  highlights.delete(FIND_HIGHLIGHT)
  highlights.delete(FIND_HIGHLIGHT_CURRENT)
}

function openAncestorDetails(from: Node, root: HTMLElement) {
  let current: Node | null = from
  if (current instanceof Text) current = current.parentElement
  while (current && current !== root) {
    if (current instanceof HTMLDetailsElement && !current.open) {
      current.open = true
    }
    current = current.parentElement
  }
}

/** Open collapsed ancestors, then scroll the current range into view. */
export function revealFindRange(range: Range, root: HTMLElement) {
  openAncestorDetails(range.startContainer, root)
  const node = range.startContainer
  const element = node instanceof Element ? node : node.parentElement
  if (element instanceof HTMLElement) {
    if (!navigateTranscriptElement(element, "nearest"))
      element.scrollIntoView?.({ block: "nearest", inline: "nearest" })
    return true
  }
  return false
}

export function revealFindFlash(root: HTMLElement) {
  if (!navigateTranscriptElement(root, "nearest"))
    root.scrollIntoView?.({ block: "nearest", inline: "nearest" })
}

export type PaintedFind = {
  activeArticle: HTMLElement | null
  current: Range | null
  flash: boolean
  editor?: EditorFindTarget
}

export type FindPaintValue = {
  query: string
  activeNodeId: string | null
  activeIndexInNode: number
  activeFindCount: number
  activeEditorKey?: string
  activeEditorStart?: number
  activeFieldKey?: string
  activeFieldIndex?: number
  activeFieldCount?: number
}
export type FindPaintCache = Map<
  HTMLElement,
  { ranges: Range[]; painted: PaintedFind }
>

function paintArticle(article: HTMLElement, value: FindPaintValue) {
  const needle = normalizeQuery(value.query)
  const active = article.getAttribute("data-find-node") === value.activeNodeId
  const painted: PaintedFind = {
    activeArticle: active ? article : null,
    current: null,
    flash: false,
  }
  const ranges: Range[] = []
  article.removeAttribute("data-find-flash")
  const views = mountedFindEditors(article)
  const fields = new Map<string, HTMLElement>()
  for (const field of article.querySelectorAll<HTMLElement>(
    "[data-find-field]"
  ))
    fields.set(field.getAttribute("data-find-field")!, field)
  for (const view of views) {
    const key = view.dom
      .closest("[data-find-editor-key]")
      ?.getAttribute("data-find-editor-key")
    const starts = editorFindStarts(view, needle)
    let current = -1
    if (active && key === value.activeEditorKey) {
      current = value.activeFieldIndex ?? -1
      if (
        (value.activeFieldCount != null &&
          starts.length !== value.activeFieldCount) ||
        current < 0 ||
        current >= starts.length ||
        (value.activeEditorStart != null &&
          starts[current] !== value.activeEditorStart)
      ) {
        current = -1
        painted.flash = true
      } else
        painted.editor = {
          view,
          start: starts[current]!,
          end: starts[current]! + needle.length,
        }
    }
    paintEditorFind(view, starts, needle.length, current)
  }
  if (fields.size) {
    for (const [key, field] of fields) {
      // CodeMirror owns its document; never mix its matches with DOM ranges.
      if (field.querySelector(".cm-editor")) continue
      const fieldRanges = collectFindRanges(field, needle).ranges
      ranges.push(...fieldRanges)
      if (active && key === value.activeFieldKey && !value.activeEditorKey) {
        const resolved = resolveCurrentFindRange(
          fieldRanges,
          value.activeFieldIndex ?? -1,
          value.activeFieldCount ?? 0
        )
        painted.current = resolved.current
        painted.flash = resolved.flash
      }
    }
    if (
      active &&
      !painted.current &&
      !painted.editor &&
      value.activeIndexInNode >= 0
    )
      painted.flash = true
  } else if (views.length === 0) {
    const articleRanges = collectFindRanges(article, needle).ranges
    ranges.push(...articleRanges)
    if (active) {
      const resolved = resolveCurrentFindRange(
        articleRanges,
        value.activeIndexInNode,
        value.activeFindCount
      )
      painted.current = resolved.current
      painted.flash = resolved.flash
    }
  }
  if (painted.flash) article.setAttribute("data-find-flash", "")
  return { ranges, painted }
}

/** Repaint specified messages; reuse all other mounted messages' live ranges. */
export function paintMountedFindHighlights(
  root: HTMLElement,
  value: FindPaintValue,
  cache: FindPaintCache = new Map(),
  dirty?: Iterable<HTMLElement>
): PaintedFind {
  for (const article of cache.keys())
    if (!root.contains(article)) cache.delete(article)
  const articles =
    dirty ?? root.querySelectorAll<HTMLElement>("[data-find-node]")
  for (const article of articles) {
    if (root.contains(article)) cache.set(article, paintArticle(article, value))
  }
  const ranges: Range[] = []
  let painted: PaintedFind = {
    activeArticle: null,
    current: null,
    flash: false,
  }
  for (const [article, entry] of cache) {
    ranges.push(...entry.ranges)
    if (article.getAttribute("data-find-node") === value.activeNodeId)
      painted = entry.painted
  }
  publishFindHighlights(ranges, painted.current)
  return painted
}

export function revealPaintedFind(
  article: HTMLElement,
  painted: Pick<PaintedFind, "current" | "flash" | "editor">
) {
  if (painted.editor) revealEditorFind(painted.editor)
  else if (painted.current) revealFindRange(painted.current, article)
  else if (painted.flash || article.hasAttribute("data-find-flash")) {
    revealFindFlash(article)
  }
}
