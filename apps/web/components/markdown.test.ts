// @vitest-environment jsdom

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Markdown } from "@/components/markdown"

function renderStreaming(source: string) {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(
      createElement(Markdown, { children: source, streaming: true })
    ),
    "text/html"
  )
}

describe("streaming Markdown math", () => {
  it("hides raw KaTeX errors for unfinished math", () => {
    const document = renderStreaming(`$$\\begin{aligned}
y &= \\frac{x^2}{2}`)

    expect(document.querySelector(".katex-error")).toBeNull()
    expect(document.querySelector("[data-math-pending]")).not.toBeNull()
    expect(document.body.textContent).not.toContain("\\")
  })

  it("renders completed math normally", () => {
    const document = renderStreaming(`Before $\\sqrt{x}$ after`)

    expect(document.querySelector(".katex")).not.toBeNull()
    expect(document.querySelector(".katex-error")).toBeNull()
    expect(document.querySelector("[data-math-pending]")).toBeNull()
  })
})
