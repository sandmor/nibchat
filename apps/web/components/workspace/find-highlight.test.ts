/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest"
import {
  collectFindRanges,
  ensureFindHighlightStyles,
  FIND_HIGHLIGHT,
  FIND_HIGHLIGHT_CURRENT,
  paintMountedFindHighlights,
  resolveCurrentFindRange,
  revealFindRange,
} from "./find-highlight"

function article(html: string) {
  const root = document.createElement("article")
  root.innerHTML = html
  return root
}

describe("collectFindRanges", () => {
  it("finds case-insensitive matches without wrapping marks", () => {
    const root = article("<p>Foo bar FOO</p>")
    const { ranges } = collectFindRanges(root, "foo")
    expect(ranges).toHaveLength(2)
    expect(ranges[0]!.toString()).toBe("Foo")
    expect(ranges[1]!.toString()).toBe("FOO")
    expect(root.querySelectorAll("mark")).toHaveLength(0)
  })

  it("skips reasoning and find-skip regions", () => {
    const root = article(
      '<p>hit</p><div class="markdown-content-reasoning">hit</div><span data-find-skip>hit</span>'
    )
    expect(collectFindRanges(root, "hit").ranges).toHaveLength(1)
  })

  it("yields no ranges for an empty query", () => {
    const root = article("<p>visible</p>")
    expect(collectFindRanges(root, "   ").ranges).toHaveLength(0)
  })

  it("finds a query that spans adjacent text nodes", () => {
    const root = article("<p>hello <strong>world</strong></p>")
    const { ranges } = collectFindRanges(root, "hello world")
    expect(ranges).toHaveLength(1)
    expect(ranges[0]!.toString()).toBe("hello world")
  })
})

describe("resolveCurrentFindRange", () => {
  it("picks the nth range when counts match", () => {
    const root = article("<p>Foo bar FOO</p>")
    const { ranges } = collectFindRanges(root, "foo")
    const resolved = resolveCurrentFindRange(ranges, 1, 2)
    expect(resolved.flash).toBe(false)
    expect(resolved.current).toBe(ranges[1])
  })

  it("flashes when DOM count disagrees with find-text count", () => {
    const root = article("<p>visible</p>")
    const { ranges } = collectFindRanges(root, "missing")
    expect(resolveCurrentFindRange(ranges, 0, 1)).toEqual({
      current: null,
      flash: true,
    })
  })

  it("does not flash when nothing is current", () => {
    expect(resolveCurrentFindRange([], -1, 0)).toEqual({
      current: null,
      flash: false,
    })
  })
})

describe("paintMountedFindHighlights", () => {
  it("paints the current range after the active article mounts", () => {
    const root = document.createElement("div")
    const value = {
      query: "token",
      activeNodeId: "n1",
      activeIndexInNode: 0,
      activeFindCount: 1,
    }
    expect(paintMountedFindHighlights(root, value).activeArticle).toBeNull()

    const mounted = article("<p>secret token here</p>")
    mounted.setAttribute("data-find-node", "n1")
    root.append(mounted)
    const painted = paintMountedFindHighlights(root, value)
    expect(painted.activeArticle).toBe(mounted)
    expect(painted.flash).toBe(false)
    expect(painted.current?.toString()).toBe("token")
  })
})

describe("revealFindRange", () => {
  it("opens collapsed details that contain the current range", () => {
    const root = article(
      "<details><summary>Attached</summary><p>secret token</p></details>"
    )
    const details = root.querySelector("details")
    expect(details?.open).toBe(false)
    const { ranges } = collectFindRanges(root, "secret")
    expect(revealFindRange(ranges[0]!, root)).toBe(true)
    expect(details?.open).toBe(true)
  })
})

describe("ensureFindHighlightStyles", () => {
  it("injects highlight rules once, outside the LightningCSS bundle", () => {
    ensureFindHighlightStyles()
    ensureFindHighlightStyles()
    const token = `:${":"}highlight(${FIND_HIGHLIGHT})`
    const styles = [...document.head.querySelectorAll("style")].filter((el) =>
      el.textContent?.includes(token)
    )
    expect(styles).toHaveLength(1)
    expect(styles[0]!.textContent).toContain(
      `:${":"}highlight(${FIND_HIGHLIGHT_CURRENT})`
    )
    expect(styles[0]!.textContent).toContain("var(--conversation-find-match)")
  })
})
