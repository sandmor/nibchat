import { describe, expect, it } from "vitest"
import { chatTemplateDocumentSchema } from "@/lib/chat-template"

describe("chat template graph", () => {
  it("accepts sibling roots and preserves their selection", () => {
    const document = chatTemplateDocumentSchema.parse({
      version: 1,
      selectedRootId: "second",
      expandMessageMacros: true,
      nodes: [
        {
          id: "first",
          parentId: null,
          selectedChildId: null,
          sortKey: 0,
          role: "assistant",
          parts: [{ type: "text", text: "One" }],
          excludedFromContext: false,
        },
        {
          id: "second",
          parentId: null,
          selectedChildId: null,
          sortKey: 1,
          role: "assistant",
          parts: [{ type: "text", text: "Two" }],
          excludedFromContext: false,
        },
      ],
    })
    expect(document.selectedRootId).toBe("second")
    expect(document.nodes.every((node) => node.branchIndex === null)).toBe(
      true
    )
  })

  it("rejects broken selections and cycles", () => {
    expect(() =>
      chatTemplateDocumentSchema.parse({
        version: 1,
        selectedRootId: "a",
        nodes: [
          {
            id: "a",
            parentId: "b",
            selectedChildId: null,
            sortKey: 0,
            role: "user",
            parts: [],
            excludedFromContext: false,
          },
          {
            id: "b",
            parentId: "a",
            selectedChildId: null,
            sortKey: 0,
            role: "assistant",
            parts: [],
            excludedFromContext: false,
          },
        ],
      })
    ).toThrow(/cycle/)
  })
})
