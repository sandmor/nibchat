// @vitest-environment jsdom

import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  emptyQuestionInput,
  type QuestionInput,
} from "@/lib/agent/tools/question-shared"
import { QuestionInputEditor } from "./question-tool"

function Harness({
  initial,
  onValue,
}: {
  initial: QuestionInput
  onValue: (next: QuestionInput) => void
}) {
  const [value, setValue] = useState(initial)
  return createElement(QuestionInputEditor, {
    value,
    onChange: (next) => {
      setValue(next)
      onValue(next)
    },
  })
}

describe("QuestionInputEditor", () => {
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

  it("authors on the live questionnaire cards, not a schema form", () => {
    let latest = emptyQuestionInput()
    act(() =>
      root.render(
        createElement(Harness, {
          initial: latest,
          onValue: (next) => {
            latest = next
          },
        })
      )
    )

    const prompt = container.querySelector(
      'textarea[aria-label="Question prompt"]'
    ) as HTMLTextAreaElement
    const header = container.querySelector(
      'input[aria-label="Question header"]'
    ) as HTMLInputElement
    const choice = container.querySelector(
      '[data-slot="questionnaire-choice"]'
    )
    const custom = container.querySelector(
      'input[aria-label="Another answer"]'
    ) as HTMLInputElement

    expect(prompt).toBeTruthy()
    expect(header).toBeTruthy()
    expect(choice).toBeTruthy()
    expect(choice?.contains(prompt)).toBe(false)
    expect(
      container.querySelectorAll('[data-slot="questionnaire-choice"]')
    ).toHaveLength(1)
    expect(custom?.getAttribute("placeholder")).toBe("Type another answer…")
    expect(custom?.hasAttribute("readonly")).toBe(true)

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )?.set
      setter?.call(prompt, "Pick a direction")
      prompt.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(latest.questions[0]?.question).toBe("Pick a direction")

    const addOption = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Add option"
    )
    expect(addOption).toBeTruthy()
    act(() => {
      addOption?.click()
    })
    expect(latest.questions[0]?.options).toHaveLength(2)
    expect(
      container.querySelectorAll('[data-slot="questionnaire-choice"]')
    ).toHaveLength(2)
  })
})
