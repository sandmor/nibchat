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
  return css.highlights ?? null
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
    element.scrollIntoView?.({ block: "nearest", inline: "nearest" })
    return true
  }
  return false
}

export function revealFindFlash(root: HTMLElement) {
  root.scrollIntoView?.({ block: "nearest", inline: "nearest" })
}

export type PaintedFind = {
  activeArticle: HTMLElement | null
  current: Range | null
  flash: boolean
}

/** Highlight currently mounted `[data-find-node]` articles. */
export function paintMountedFindHighlights(
  root: HTMLElement,
  value: {
    query: string
    activeNodeId: string | null
    activeIndexInNode: number
    activeFindCount: number
  }
): PaintedFind {
  const matches: Range[] = []
  let current: Range | null = null
  let activeArticle: HTMLElement | null = null
  let flash = false
  for (const article of root.querySelectorAll<HTMLElement>(
    "[data-find-node]"
  )) {
    article.removeAttribute("data-find-flash")
    const { ranges } = collectFindRanges(article, value.query)
    const nodeId = article.getAttribute("data-find-node")
    if (nodeId === value.activeNodeId) {
      activeArticle = article
      const resolved = resolveCurrentFindRange(
        ranges,
        value.activeIndexInNode,
        value.activeFindCount
      )
      flash = resolved.flash
      current = resolved.current
      if (flash) article.setAttribute("data-find-flash", "")
    }
    matches.push(...ranges)
  }
  publishFindHighlights(matches, current)
  return { activeArticle, current, flash }
}

export function revealPaintedFind(
  article: HTMLElement,
  painted: Pick<PaintedFind, "current" | "flash">
) {
  if (painted.current) revealFindRange(painted.current, article)
  else if (painted.flash || article.hasAttribute("data-find-flash")) {
    revealFindFlash(article)
  }
}
