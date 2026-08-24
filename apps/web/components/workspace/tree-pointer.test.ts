/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest"
import {
  consumeTreeWheel,
  pointerOnFocusedSelectable,
  treeWheelScroller,
  wheelTargetScrolls,
} from "./tree-camera"

function card(id: string, live: boolean) {
  const el = document.createElement("div")
  el.setAttribute("data-tree-hit", id)
  if (live) el.setAttribute("data-tree-live", "")
  const text = document.createElement("p")
  text.textContent = "Hello World"
  el.append(text)
  document.body.append(el)
  return { el, text }
}

function scrollMetrics(
  el: HTMLElement,
  metrics: {
    scrollHeight: number
    clientHeight: number
    scrollTop: number
    scrollWidth?: number
    clientWidth?: number
    scrollLeft?: number
  }
) {
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get: () => metrics.scrollHeight,
  })
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    get: () => metrics.clientHeight,
  })
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => metrics.scrollTop,
    set: (value: number) => {
      metrics.scrollTop = value
    },
  })
  Object.defineProperty(el, "scrollWidth", {
    configurable: true,
    get: () => metrics.scrollWidth ?? 100,
  })
  Object.defineProperty(el, "clientWidth", {
    configurable: true,
    get: () => metrics.clientWidth ?? 100,
  })
  Object.defineProperty(el, "scrollLeft", {
    configurable: true,
    get: () => metrics.scrollLeft ?? 0,
    set: (value: number) => {
      metrics.scrollLeft = value
    },
  })
  return metrics
}

function liveMessageCard() {
  const hit = document.createElement("div")
  hit.setAttribute("data-tree-hit", "node-a")
  hit.setAttribute("data-tree-live", "")
  const body = document.createElement("div")
  body.setAttribute("data-tree-scroll", "")
  const text = document.createElement("p")
  text.textContent = "Hello World"
  body.append(text)
  const footer = document.createElement("div")
  footer.dataset.footer = ""
  hit.append(body, footer)
  document.body.append(hit)
  return { hit, body, text, footer }
}

describe("pointerOnFocusedSelectable", () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it("lets the focused live card keep a text drag", () => {
    const { text } = card("node-a", true)
    expect(pointerOnFocusedSelectable(text, "node-a")).toBe(true)
  })

  it("still pans from an unfocused live card", () => {
    const { text } = card("node-a", true)
    expect(pointerOnFocusedSelectable(text, "node-b")).toBe(false)
  })

  it("still pans from a focused map plaque", () => {
    const { text } = card("node-a", false)
    expect(pointerOnFocusedSelectable(text, "node-a")).toBe(false)
  })

  it("still pans when nothing is focused", () => {
    const { text } = card("node-a", true)
    expect(pointerOnFocusedSelectable(text, null)).toBe(false)
  })
})

describe("tree wheel targeting", () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it("keeps the wheel on the message body while it can still scroll", () => {
    const { text, body } = liveMessageCard()
    scrollMetrics(body, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 20,
    })
    expect(treeWheelScroller(text, 0, 40)).toBe(body)
    expect(wheelTargetScrolls(text, 0, 40)).toBe(true)
  })

  it("scrolls the message body when the wheel is over the action row", () => {
    const { body, footer } = liveMessageCard()
    const metrics = scrollMetrics(body, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 20,
    })
    expect(treeWheelScroller(footer, 0, 40)).toBe(body)
    let prevented = false
    expect(
      consumeTreeWheel({
        target: footer,
        deltaX: 0,
        deltaY: 40,
        preventDefault: () => {
          prevented = true
        },
      })
    ).toBe(true)
    expect(prevented).toBe(true)
    expect(metrics.scrollTop).toBe(60)
  })

  it("leaves native scrolling alone when the wheel is already on the port", () => {
    const { text, body } = liveMessageCard()
    const metrics = scrollMetrics(body, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 20,
    })
    let prevented = false
    expect(
      consumeTreeWheel({
        target: text,
        deltaX: 0,
        deltaY: 40,
        preventDefault: () => {
          prevented = true
        },
      })
    ).toBe(true)
    expect(prevented).toBe(false)
    expect(metrics.scrollTop).toBe(20)
  })

  it("gives the canvas the wheel when the card cannot scroll further", () => {
    const { footer, body } = liveMessageCard()
    scrollMetrics(body, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    })
    expect(treeWheelScroller(footer, 0, 40)).toBeNull()
    expect(wheelTargetScrolls(footer, 0, 40)).toBe(false)
  })

  it("still pans from a map plaque", () => {
    const { text } = card("node-a", false)
    expect(wheelTargetScrolls(text, 0, 40)).toBe(false)
  })

  it("lets unscrolled chrome keep the wheel", () => {
    const chrome = document.createElement("div")
    chrome.setAttribute("data-tree-chrome", "")
    const label = document.createElement("span")
    chrome.append(label)
    document.body.append(chrome)
    expect(wheelTargetScrolls(label, 0, 40)).toBe(true)
    expect(treeWheelScroller(label, 0, 40)).toBeNull()
  })

  it("uses composer field overflow instead of treating the shell as unscrolled chrome", () => {
    const composer = document.createElement("div")
    composer.setAttribute("data-tree-chrome", "")
    const field = document.createElement("textarea")
    field.setAttribute("data-tree-scroll", "")
    composer.append(field)
    document.body.append(composer)
    scrollMetrics(field, {
      scrollHeight: 240,
      clientHeight: 80,
      scrollTop: 10,
    })
    expect(treeWheelScroller(field, 0, 20)).toBe(field)
  })
})
