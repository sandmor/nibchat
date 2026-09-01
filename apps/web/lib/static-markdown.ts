import DOMPurify from "isomorphic-dompurify"
import katex from "katex"
import { Marked, type RendererObject, type Token, type Tokens } from "marked"
import { code } from "@streamdown/code"
import {
  escapeHtml,
  isExternalMarkdownLink,
  renderStaticCodeBlock,
  renderStaticTable,
  safeMarkdownUrl,
} from "@/lib/markdown-blocks"

function highlightedCode(source: string, language: string) {
  if (!language || !code.supportsLanguage(language as never)) return null
  const result = code.highlight({
    code: source,
    language: language as never,
    themes: code.getThemes(),
  })
  if (!result) return null
  return result.tokens.map((line) =>
    line
      .map((token) => {
        const style = Object.entries(token.htmlStyle ?? {})
          .filter(
            ([name, value]) =>
              (name === "color" || name === "--shiki-dark") &&
              typeof value === "string" &&
              /^#[0-9a-f]{3,8}$/i.test(value)
          )
          .map(([name, value]) => `${name}:${value}`)
          .join(";")
        return /* HTML */ `<span${style ? ` style="${style}"` : ""}>${escapeHtml(token.content)}</span>`
      })
      .join("")
  )
}

const SAFE_RAW_HTML = {
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: true,
  FORBID_ATTR: ["style", "id", "name", "target"],
  FORBID_TAGS: ["button", "form", "iframe", "input", "object", "script"],
  USE_PROFILES: { html: true },
}

function sanitizeRawHtml(source: string) {
  return String(DOMPurify.sanitize(source, SAFE_RAW_HTML))
}

function staticLink(href: string, title: string | null, body: string) {
  const safe = safeMarkdownUrl(href)
  if (!safe) return body
  const external = isExternalMarkdownLink(safe)
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : ""
  return /* HTML */ `<a
    class="font-medium wrap-anywhere text-primary underline underline-offset-2 hover:text-foreground"
    href="${escapeHtml(safe)}"
    ${titleAttr}${external ? ' target="_blank" rel="noopener noreferrer"' : ""}
    >${body}</a
  >`
}

function staticImage(href: string, title: string | null, text: string) {
  const safe = safeMarkdownUrl(href, true)
  if (!safe) return ""
  const alt = escapeHtml(text)
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : ""
  return /* HTML */ `<span
    class="my-3 inline-flex max-w-full"
    data-markdown-image-wrapper=""
  >
    <img
      class="max-h-96 max-w-full rounded-lg"
      src="${escapeHtml(safe)}"
      alt="${alt}"
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      ${titleAttr}
    />
    <span
      class="hidden rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground"
      data-markdown-image-fallback=""
      >Image unavailable${alt ? `: ${alt}` : ""}</span
    >
  </span>`
}

function staticTable(
  this: { parser: { parseInline: (tokens: Token[]) => string } },
  token: Tokens.Table
) {
  const header = token.header
    .map((cell) => {
      const align = cell.align ? ` style="text-align:${cell.align}"` : ""
      return /* HTML */ `<th
        class="px-4 py-2 text-left text-sm font-semibold whitespace-nowrap"
        ${align}
      >
        ${this.parser.parseInline(cell.tokens)}
      </th>`
    })
    .join("")
  const rows = token.rows
    .map(
      (row) =>
        /* HTML */ `<tr class="border-border">
          ${row
            .map((cell) => {
              const align = cell.align
                ? ` style="text-align:${cell.align}"`
                : ""
              return /* HTML */ `<td class="px-4 py-2 text-sm" ${align}>
                ${this.parser.parseInline(cell.tokens)}
              </td>`
            })
            .join("")}
        </tr>`
    )
    .join("")
  return renderStaticTable(
    /* HTML */ `<table
      class="w-full divide-y divide-border"
      data-streamdown="table"
    >
      <thead class="bg-muted" data-streamdown="table-header">
        <tr class="border-border">
          ${header}
        </tr>
      </thead>
      <tbody class="divide-y divide-border">
        ${rows}
      </tbody>
    </table>`
  )
}

const renderer: RendererObject = {
  code(token) {
    const language = token.lang?.trim().split(/\s+/)[0] ?? ""
    return renderStaticCodeBlock(
      token.text,
      token.lang,
      highlightedCode(token.text, language) ?? undefined
    )
  },
  html(token) {
    return sanitizeRawHtml(token.text)
  },
  image(token) {
    return staticImage(token.href, token.title, token.text)
  },
  link(token) {
    return staticLink(
      token.href,
      token.title ?? null,
      this.parser.parseInline(token.tokens)
    )
  },
  table: staticTable,
}

const marked = new Marked({ async: false, gfm: true, renderer })
marked.use({
  extensions: [
    {
      name: "staticInlineKatex",
      level: "inline",
      start(src) {
        return src.indexOf("$")
      },
      tokenizer(src) {
        const match = src.match(
          /^(\${1,2})(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n$]))\1/
        )
        if (!match) return
        return {
          type: "staticInlineKatex",
          raw: match[0],
          text: (match[2] ?? "").trim(),
          displayMode: (match[1] ?? "").length === 2,
        }
      },
      renderer(token) {
        const math = token as Tokens.Generic & {
          text: string
          displayMode: boolean
        }
        return katex.renderToString(math.text, {
          displayMode: math.displayMode,
          errorColor: "var(--color-muted-foreground)",
          throwOnError: false,
          trust: false,
        })
      },
    },
    {
      name: "staticBlockKatex",
      level: "block",
      tokenizer(src) {
        const match = src.match(
          /^\${1,2}\n((?:\\[^]|[^\\])+?)\n\${1,2}(?:\n|$)/
        )
        if (!match) return
        const delimiter = match[0].startsWith("$$") ? "$$" : "$"
        return {
          type: "staticBlockKatex",
          raw: match[0],
          text: (match[1] ?? "").trim(),
          displayMode: delimiter === "$$",
        }
      },
      renderer(token) {
        const math = token as Tokens.Generic & {
          text: string
          displayMode: boolean
        }
        return `${katex.renderToString(math.text, {
          displayMode: math.displayMode,
          errorColor: "var(--color-muted-foreground)",
          throwOnError: false,
          trust: false,
        })}\n`
      },
    },
  ],
})

export function renderStaticMarkdown(source: string) {
  return marked.parse(source, { async: false })
}

type MarkdownSnapshot = { readonly __html: string }

class StaticMarkdownEntry {
  private listeners = new Set<() => void>()
  private readonly serverSnapshot: MarkdownSnapshot
  private snapshot: MarkdownSnapshot

  constructor(source: string) {
    const html = renderStaticMarkdown(source)
    this.snapshot = Object.freeze({ __html: html })
    this.serverSnapshot = this.snapshot
    this.warmCodeHighlighting(source)
  }

  getSnapshot = () => this.snapshot
  getServerSnapshot = () => this.serverSnapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private warmCodeHighlighting(source: string) {
    const fences = [
      ...source.matchAll(
        /^ {0,3}(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\1[ \t]*$/gm
      ),
    ]
    let waiting = 0
    const refresh = () => {
      const html = renderStaticMarkdown(source)
      if (html === this.snapshot.__html) return
      this.snapshot = Object.freeze({ __html: html })
      for (const listener of this.listeners) listener()
    }
    for (const match of fences) {
      const info = match[2] ?? ""
      const language = info.trim().split(/\s+/)[0] ?? ""
      if (!language || !code.supportsLanguage(language as never)) continue
      const sourceCode = match[3] ?? ""
      const result = code.highlight(
        {
          code: sourceCode,
          language: language as never,
          themes: code.getThemes(),
        },
        () => {
          waiting -= 1
          if (waiting === 0) refresh()
        }
      )
      if (!result) waiting += 1
    }
    if (waiting === 0) refresh()
  }
}

/** Bounded session-local cache of final Markdown HTML. */
export class StaticMarkdownCache {
  private entries = new Map<string, StaticMarkdownEntry>()

  constructor(private readonly maxEntries = 4_000) {}

  get(source: string) {
    const existing = this.entries.get(source)
    if (existing) {
      this.entries.delete(source)
      this.entries.set(source, existing)
      return existing
    }
    const entry = new StaticMarkdownEntry(source)
    this.entries.set(source, entry)
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest == null) break
      this.entries.delete(oldest)
    }
    return entry
  }
}

export const staticMarkdownCache = new StaticMarkdownCache()

/** Pre-build a final message's HTML while its live Streamdown overlay remains visible. */
export function prepareStaticMarkdown(source: string) {
  return staticMarkdownCache.get(source)
}
