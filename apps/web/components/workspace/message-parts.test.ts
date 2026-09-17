// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Parts, ToolInvocationPart } from "@/lib/types"
import { MessageParts } from "./message-parts"

vi.mock("@/components/markdown", () => ({
  Markdown: ({ children }: { children?: unknown }) =>
    createElement("div", { "data-markdown": "" }, children as string),
}))

const tool = (
  toolName: string,
  state: ToolInvocationPart["state"]
): ToolInvocationPart => ({
  type: "tool-invocation",
  toolCallId: toolName,
  toolName,
  state,
  input: {},
})

describe("MessageParts activity collapse", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function renderParts(parts: Parts, streaming = false) {
    act(() => {
      root.render(createElement(MessageParts, { parts, streaming }))
    })
  }

  function blocks() {
    return [...container.querySelectorAll("details")]
  }

  it("keeps live reasoning open until later text arrives", () => {
    renderParts([{ type: "reasoning", text: "Plan" }], true)
    expect(blocks()[0]?.open).toBe(true)

    renderParts(
      [
        { type: "reasoning", text: "Plan" },
        { type: "text", text: "Answer" },
      ],
      true
    )
    expect(blocks()[0]?.open).toBe(false)
  })

  it("starts a later activity group open while the earlier one is folded", () => {
    renderParts(
      [
        { type: "reasoning", text: "Plan" },
        { type: "text", text: "Mid" },
        { type: "reasoning", text: "Review" },
      ],
      true
    )
    expect(blocks().map((block) => block.open)).toEqual([false, true])
  })

  it("folds when the stream ends even without later text", () => {
    renderParts([{ type: "reasoning", text: "Plan" }], true)
    expect(blocks()[0]?.open).toBe(true)
    renderParts([{ type: "reasoning", text: "Plan" }])
    expect(blocks()[0]?.open).toBe(false)
  })

  it("does not re-collapse after the reader expands it", () => {
    renderParts(
      [
        { type: "reasoning", text: "Plan" },
        { type: "text", text: "Answer" },
      ],
      true
    )
    expect(blocks()[0]?.open).toBe(false)
    act(() => {
      blocks()[0]?.querySelector("summary")?.click()
    })
    expect(blocks()[0]?.open).toBe(true)
    renderParts(
      [
        { type: "reasoning", text: "Plan" },
        { type: "text", text: "Answer more" },
      ],
      true
    )
    expect(blocks()[0]?.open).toBe(true)
  })

  it("keeps a busy tool group open after later text starts", () => {
    renderParts(
      [
        { type: "reasoning", text: "Plan" },
        tool("search", "input-streaming"),
        { type: "text", text: "Answer" },
      ],
      true
    )
    expect(blocks()[0]?.open).toBe(true)
    expect(blocks()[0]?.textContent).toContain("Working…")
  })

  it("starts historical reasoning collapsed", () => {
    renderParts([{ type: "reasoning", text: "Plan" }])
    expect(blocks()[0]?.open).toBe(false)
  })
})
