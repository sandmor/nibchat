import { describe, expect, it } from "vitest"
import {
  conversationFindKeyAction,
  type FindKeyContext,
} from "./conversation-find-keys"

const base: FindKeyContext = {
  findOpen: true,
  pendingPathSwitch: false,
  renameOpen: false,
  view: "linear",
  canUseThisPath: false,
  inPane: true,
  inFindInput: false,
  inDialog: false,
}

describe("conversationFindKeyAction", () => {
  it("opens find with Ctrl/Cmd+F only when the pane is focused or find is open", () => {
    expect(
      conversationFindKeyAction(
        { key: "f", metaKey: true, ctrlKey: false, shiftKey: false },
        { ...base, findOpen: false }
      )
    ).toBe("open")
    expect(
      conversationFindKeyAction(
        { key: "f", metaKey: false, ctrlKey: true, shiftKey: false },
        { ...base, findOpen: false, inPane: false }
      )
    ).toBeNull()
    expect(
      conversationFindKeyAction(
        { key: "f", metaKey: true, ctrlKey: false, shiftKey: false },
        { ...base, findOpen: true, inPane: false }
      )
    ).toBe("open")
  })

  it("closes on Escape unless a dialog or pending switch owns it", () => {
    expect(
      conversationFindKeyAction(
        { key: "Escape", metaKey: false, ctrlKey: false, shiftKey: false },
        base
      )
    ).toBe("close")
    expect(
      conversationFindKeyAction(
        { key: "Escape", metaKey: false, ctrlKey: false, shiftKey: false },
        { ...base, inDialog: true }
      )
    ).toBeNull()
    expect(
      conversationFindKeyAction(
        { key: "Escape", metaKey: false, ctrlKey: false, shiftKey: false },
        { ...base, pendingPathSwitch: true }
      )
    ).toBeNull()
  })

  it("steps from the find input Enter, not from result rows", () => {
    expect(
      conversationFindKeyAction(
        { key: "Enter", metaKey: false, ctrlKey: false, shiftKey: false },
        { ...base, inFindInput: true }
      )
    ).toBe("next")
    expect(
      conversationFindKeyAction(
        { key: "Enter", metaKey: false, ctrlKey: false, shiftKey: true },
        { ...base, inFindInput: true }
      )
    ).toBe("prev")
    expect(
      conversationFindKeyAction(
        { key: "Enter", metaKey: false, ctrlKey: false, shiftKey: false },
        { ...base, inFindInput: false }
      )
    ).toBeNull()
  })

  it("uses F3 / Ctrl+G for next and previous", () => {
    expect(
      conversationFindKeyAction(
        { key: "F3", metaKey: false, ctrlKey: false, shiftKey: false },
        base
      )
    ).toBe("next")
    expect(
      conversationFindKeyAction(
        { key: "g", metaKey: true, ctrlKey: false, shiftKey: true },
        base
      )
    ).toBe("prev")
  })
})
