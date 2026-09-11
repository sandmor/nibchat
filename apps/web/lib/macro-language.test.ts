import { describe, expect, it } from "vitest"
import { EditorState } from "@codemirror/state"
import { macroCompletionContext } from "@/components/workspace/settings/macro-editor"

function completion(text: string, pos = text.length) {
  return macroCompletionContext(EditorState.create({ doc: text }), pos)
}

describe("macro editor language", () => {
  it("completes macro names and variable prefixes", () => {
    expect(completion("{{")).toEqual({ kind: "expression", from: 2, to: 2 })
    expect(completion("{{vars.")).toEqual({ kind: "variable", from: 7, to: 7 })
    expect(completion("Hello {{ti")).toEqual({
      kind: "expression",
      from: 8,
      to: 10,
    })
  })

  it("does not complete in prose or quoted arguments", () => {
    expect(completion("Hello world")).toBeNull()
    expect(completion('{{hash("hi')).toBeNull()
  })
})
