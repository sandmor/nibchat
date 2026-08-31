// @vitest-environment jsdom

import { act, createElement, createRef, Fragment, startTransition } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PathRewriteViewportPin } from "./transcript-viewport-pin"

const suspended = new Promise<never>(() => {})

function rect(top: number, bottom: number): DOMRect {
  return {
    bottom,
    height: bottom - top,
    left: 0,
    right: 100,
    top,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }
}

function Suspend({ active }: { active: boolean }) {
  if (active) throw suspended
  return null
}

describe("PathRewriteViewportPin", () => {
  let container: HTMLDivElement
  let root: Root
  const viewportRef = createRef<HTMLDivElement>()

  function renderHarness({
    pathSignature,
    itemTop,
    suspend = false,
  }: {
    pathSignature: string
    itemTop: number
    suspend?: boolean
  }) {
    root.render(
      createElement(
        Fragment,
        null,
        createElement(PathRewriteViewportPin, {
          pathSignature,
          scrollTargetId: null,
          viewportRef,
        }),
        createElement(
          "div",
          { ref: viewportRef, "data-viewport": "true" },
          createElement("div", {
            "data-slot": "message-scroller-item",
            "data-top": itemTop,
          })
        ),
        createElement(Suspend, { active: suspend })
      )
    )
  }

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const element = this as HTMLElement
        if (element.dataset.viewport) return rect(0, 100)
        const top = Number(element.dataset.top)
        return rect(top, top + 20)
      }
    )
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it("captures old geometry before a committed path rewrite", () => {
    act(() => renderHarness({ pathSignature: "a", itemTop: 40 }))
    const viewport = viewportRef.current!
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500 },
    })
    viewport.scrollTop = 100

    act(() => renderHarness({ pathSignature: "b", itemTop: 70 }))

    expect(viewport.scrollTop).toBe(130)
  })

  it("does not read the DOM for an abandoned path render", async () => {
    act(() => renderHarness({ pathSignature: "a", itemTop: 40 }))
    const viewport = viewportRef.current!
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500 },
    })
    viewport.scrollTop = 100
    const readGeometry = vi.mocked(Element.prototype.getBoundingClientRect)
    readGeometry.mockClear()

    await act(async () => {
      startTransition(() =>
        renderHarness({ pathSignature: "b", itemTop: 70, suspend: true })
      )
      await Promise.resolve()
    })

    expect(readGeometry).not.toHaveBeenCalled()
    expect(viewport.scrollTop).toBe(100)
  })
})
