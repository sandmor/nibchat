// @vitest-environment jsdom

import { describe, expect, it } from "vitest"
import { MARKDOWN_ACTION, parseCodeFence } from "@/lib/markdown-blocks"
import {
  StaticMarkdownCache,
  renderStaticMarkdown,
} from "@/lib/static-markdown"
import { normalizeLatexDelimiters } from "@/lib/normalize-latex-delimiters"

describe("static Markdown renderer", () => {
  it("emits cached-HTML controls for code and tables", () => {
    const html = renderStaticMarkdown(`\`\`\`ts startLine=3
const answer = 42
console.log(answer)
\`\`\`

| A | B |
| - | - |
| 1 | 2 |`)

    expect(html).toContain('data-markdown-code-block=""')
    expect(html).toContain(`data-markdown-action="${MARKDOWN_ACTION.copyCode}"`)
    expect(html).toContain('data-markdown-tooltip="Copy code"')
    expect(html).toContain('data-start-line="3"')
    expect(html).not.toMatch(
      /data-markdown-code-line="">[^<]*<\/span>\n<span data-markdown-code-line/
    )
    expect(html).toContain('data-markdown-table=""')
    expect(html).toContain(
      `data-markdown-action="${MARKDOWN_ACTION.fullscreenTable}"`
    )
    expect(html).toContain(
      `data-markdown-action="${MARKDOWN_ACTION.openCopyMenu}"`
    )
    expect(html).toContain(
      `data-markdown-action="${MARKDOWN_ACTION.openDownloadMenu}"`
    )
    expect(html).not.toContain("<details")
  })

  it("renders KaTeX and rejects unsafe authored HTML", () => {
    const html = renderStaticMarkdown(
      `$x^2$\n\n<script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(1)">bad</a>`
    )

    expect(html).toContain('class="katex"')
    expect(html).not.toContain("<script")
    expect(html).not.toContain("onclick")
    expect(html).not.toContain("javascript:")
  })

  it("renders normalized multiline KaTeX with attached delimiters", () => {
    const source = `$$\\begin{cases}
a + b = 2 \\\\
6a + 7b = 4
\\end{cases}$$`
    const html = renderStaticMarkdown(normalizeLatexDelimiters(source, false))

    expect(html).toContain('class="katex-display"')
    expect(html).not.toContain("katex-error")
  })

  it("shares entries by Markdown source", () => {
    const cache = new StaticMarkdownCache(2)
    expect(cache.get("hello")).toBe(cache.get("hello"))
    expect(cache.get("hello").getSnapshot()).toEqual({
      __html: "<p>hello</p>\n",
    })
  })
})

describe("code fence metadata", () => {
  it("keeps line-number metadata renderer independent", () => {
    expect(parseCodeFence("typescript startLine=4")).toEqual({
      language: "typescript",
      lineNumbers: true,
      startLine: 4,
    })
    expect(parseCodeFence("ts noLineNumbers")).toEqual({
      language: "ts",
      lineNumbers: false,
      startLine: undefined,
    })
  })
})
