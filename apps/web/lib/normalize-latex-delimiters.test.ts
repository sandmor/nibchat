import { describe, expect, it } from "vitest"
import { normalizeLatexDelimiters } from "@/lib/normalize-latex-delimiters"

describe("normalizeLatexDelimiters", () => {
  it("converts inline and display LaTeX delimiters", () => {
    expect(normalizeLatexDelimiters("See \\(x^2\\) please", false)).toBe(
      "See $x^2$ please"
    )
    expect(normalizeLatexDelimiters("A \\[a + b\\] B", false)).toBe(
      "A \n\n$$\na + b\n$$\n\n B"
    )
  })

  it("canonicalizes attached delimiters around multiline display math", () => {
    const source = `$$\\begin{cases}
a + b = 2 \\\\
6a + 7b = 4
\\end{cases}$$`
    const expected = `$$
\\begin{cases}
a + b = 2 \\\\
6a + 7b = 4
\\end{cases}
$$`

    expect(normalizeLatexDelimiters(source, false)).toBe(expected)
    expect(normalizeLatexDelimiters("$$x^2$$", false)).toBe("$$x^2$$")
  })

  it("leaves ordinary math unchanged while streaming", () => {
    const source = `$$x^2$$
Paragraph with $$y^2$$ and $z$.

$$
a + b = 2
$$`

    expect(normalizeLatexDelimiters(source, true)).toBe(source)
  })

  it("leaves escaped delimiters in link and image destinations", () => {
    const link = "[Foo (bar)](https://en.wikipedia.org/wiki/Foo_\\(bar\\))"
    expect(normalizeLatexDelimiters(link, false)).toBe(link)
    expect(normalizeLatexDelimiters(`${link} and \\(x\\)`, false)).toBe(
      `${link} and $x$`
    )

    const image = "![img](https://example.com/a_\\(b\\).png)"
    expect(normalizeLatexDelimiters(image, false)).toBe(image)
  })

  it("leaves balanced parentheses in destinations", () => {
    const link = "[Foo](https://en.wikipedia.org/wiki/Foo_(bar))"
    expect(normalizeLatexDelimiters(`${link} \\(y\\)`, false)).toBe(
      `${link} $y$`
    )
  })

  it("leaves autolinks and fenced or inline code alone", () => {
    const autolink = "<https://en.wikipedia.org/wiki/Foo_\\(bar\\)>"
    expect(normalizeLatexDelimiters(autolink, false)).toBe(autolink)
    expect(normalizeLatexDelimiters("Use `\\(x\\)` and \\(y\\)", false)).toBe(
      "Use `\\(x\\)` and $y$"
    )
    expect(normalizeLatexDelimiters("```\n\\(x\\)\n```\n\\(y\\)", false)).toBe(
      "```\n\\(x\\)\n```\n$y$"
    )
    const attachedBlock = `$$\\begin{cases}
a + b = 2 \\\\
\\end{cases}$$`
    expect(
      normalizeLatexDelimiters(`\`\`\`latex\n${attachedBlock}\n\`\`\``, false)
    ).toBe(`\`\`\`latex\n${attachedBlock}\n\`\`\``)
  })

  it("closes unfinished inline math while streaming", () => {
    expect(normalizeLatexDelimiters("start \\(x^", true)).toBe("start $x^$")
  })

  it("canonicalizes an unfinished attached display block while streaming", () => {
    const source = `$$\\begin{cases}
a + b = 2 \\\\
6a + 7b = 4`
    expect(normalizeLatexDelimiters(source, true)).toBe(`$$
\\begin{cases}
a + b = 2 \\\\
6a + 7b = 4`)
  })
})
