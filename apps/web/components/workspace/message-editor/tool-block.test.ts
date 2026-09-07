// @vitest-environment jsdom

import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PartsEditor } from "./parts-body"
import type { Parts, ToolInvocationPart } from "@/lib/types"

const tool: ToolInvocationPart = {
  type: "tool-invocation",
  toolCallId: "call-1",
  toolName: "lookup",
  state: "output-available",
  input: { q: "old" },
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set
  setter?.call(textarea, value)
  textarea.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("tool drafts in the parts editor", () => {
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

  it("blocks save for invalid JSON without looping parent state", () => {
    let saves = 0
    function Harness() {
      const [parts, setParts] = useState<Parts>([tool])
      return createElement(PartsEditor, {
        role: "assistant",
        parts,
        keys: ["tool-1"],
        overlayNodeId: "node-1",
        onReplacePart: (index, part) =>
          setParts((current) =>
            current.map((item, i) => (i === index ? part : item))
          ),
        onInsertPart: () => {},
        onRemovePart: () => {},
        onMovePart: () => {},
        onConvertRole: () => {},
        onSend: () => {
          saves += 1
        },
      })
    }
    act(() => root.render(createElement(Harness)))
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement
    act(() => {
      setTextareaValue(textarea, "{invalid")
      textarea.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
    })
    expect(container.textContent).toContain("Invalid JSON")
    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Save branch"
      )
    ).toHaveProperty("disabled", true)
    act(() =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          bubbles: true,
        })
      )
    )
    expect(saves).toBe(0)
  })

  it("commits the current JSON draft before Ctrl+Enter saves", () => {
    let draft: Parts = [tool]
    let submitted: Parts | undefined
    function Harness() {
      const [, rerender] = useState(0)
      return createElement(PartsEditor, {
        role: "assistant",
        parts: draft,
        keys: ["tool-1"],
        overlayNodeId: "node-1",
        onReplacePart: (index, part) => {
          draft = draft.map((item, i) => (i === index ? part : item))
          rerender((tick) => tick + 1)
        },
        onInsertPart: () => {},
        onRemovePart: () => {},
        onMovePart: () => {},
        onConvertRole: () => {},
        onSend: () => {
          submitted = draft
        },
      })
    }
    act(() => root.render(createElement(Harness)))
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement
    act(() => setTextareaValue(textarea, '{"q":"fresh"}'))
    act(() =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          bubbles: true,
        })
      )
    )
    expect((submitted?.[0] as ToolInvocationPart).input).toEqual({ q: "fresh" })
  })
})
