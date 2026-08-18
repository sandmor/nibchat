import { describe, expect, it } from "vitest"
import type { NodeRow, Parts } from "@/lib/types"
import {
  messageToMarkdown,
  partsToMarkdown,
  pathToMarkdown,
} from "@/lib/message-markdown"

const node = (
  id: string,
  role: NodeRow["role"],
  parent_id: string | null,
  parts: Parts,
  selected_child_id: string | null = null
): NodeRow => ({
  id,
  chat_id: "chat",
  parent_id,
  selected_child_id,
  role,
  parts_json: JSON.stringify(parts),
  search_text: "",
  metadata_json: "{}",
  excluded_from_context: false,
  status: "complete",
  created_at: "",
  updated_at: "",
})

describe("partsToMarkdown", () => {
  it("returns the prose as-is", () => {
    expect(partsToMarkdown([{ type: "text", text: "Hello **world**" }])).toBe(
      "Hello **world**"
    )
  })

  it("coalesces adjacent text parts", () => {
    expect(
      partsToMarkdown([
        { type: "text", text: "Hel" },
        { type: "text", text: "lo" },
      ])
    ).toBe("Hello")
  })

  it("keeps text on both sides of a non-text part", () => {
    expect(
      partsToMarkdown([
        { type: "text", text: "before" },
        {
          type: "attachment",
          id: "a1",
          name: "clip.png",
          source: { kind: "upload" },
          content: {
            kind: "binary",
            attachmentId: "att",
            mediaType: "image/png",
            byteSize: 8,
            sha256: "b".repeat(64),
          },
        },
        { type: "text", text: "after" },
      ])
    ).toBe("before\n\n*[Image: clip.png]*\n\nafter")
  })

  it("omits reasoning", () => {
    expect(
      partsToMarkdown([
        { type: "reasoning", text: "hidden chain" },
        { type: "text", text: "visible" },
      ])
    ).toBe("visible")
  })

  it("renders text attachments and image placeholders", () => {
    expect(
      partsToMarkdown([
        {
          type: "attachment",
          id: "a1",
          name: "notes.md",
          source: { kind: "upload" },
          content: { kind: "text", text: "# Notes" },
        },
        {
          type: "attachment",
          id: "a2",
          name: "shot.png",
          source: { kind: "upload" },
          content: {
            kind: "binary",
            attachmentId: "att",
            mediaType: "image/png",
            byteSize: 12,
            sha256: "a".repeat(64),
          },
        },
      ])
    ).toBe("**Attachment: notes.md**\n\n# Notes\n\n*[Image: shot.png]*")
  })

  it("renders tool input and output", () => {
    expect(
      partsToMarkdown([
        {
          type: "tool-invocation",
          toolCallId: "t1",
          toolName: "lookup",
          state: "output-available",
          input: { q: "hi" },
          output: "found it",
        },
      ])
    ).toBe(
      `**Tool: lookup**

Input:

\`\`\`json
{
  "q": "hi"
}
\`\`\`

Output:

found it`
    )
  })

  it("renders tool errors instead of output", () => {
    expect(
      partsToMarkdown([
        {
          type: "tool-invocation",
          toolCallId: "t1",
          toolName: "lookup",
          state: "output-error",
          input: {},
          errorText: "timeout",
        },
      ])
    ).toContain("Error:\n\ntimeout")
  })
})

describe("pathToMarkdown", () => {
  it("joins the ancestor lineage with role headings", () => {
    const nodes = [
      node("u1", "user", null, [{ type: "text", text: "hello" }], "a1"),
      node("a1", "assistant", "u1", [{ type: "text", text: "hi there" }]),
    ]
    expect(pathToMarkdown(nodes, "a1")).toBe(
      "**User**\n\nhello\n\n**Assistant**\n\nhi there"
    )
  })

  it("follows the requested node's lineage, not the selected branch", () => {
    const nodes = [
      node("root", "user", null, [{ type: "text", text: "start" }], "on-path"),
      node("on-path", "assistant", "root", [
        { type: "text", text: "selected reply" },
      ]),
      node("off-path", "assistant", "root", [
        { type: "text", text: "other reply" },
      ]),
      node("off-child", "user", "off-path", [
        { type: "text", text: "continue other" },
      ]),
    ]
    expect(pathToMarkdown(nodes, "off-child")).toBe(
      "**User**\n\nstart\n\n**Assistant**\n\nother reply\n\n**User**\n\ncontinue other"
    )
    expect(pathToMarkdown(nodes, "off-child")).not.toContain("selected reply")
  })

  it("skips messages with nothing to copy", () => {
    const nodes = [
      node("u1", "user", null, [{ type: "text", text: "ask" }], "a1"),
      node("a1", "assistant", "u1", [{ type: "reasoning", text: "thinking" }]),
    ]
    expect(pathToMarkdown(nodes, "a1")).toBe("**User**\n\nask")
  })

  it("returns empty string when the node is missing", () => {
    expect(pathToMarkdown([], "missing")).toBe("")
  })
})

describe("messageToMarkdown", () => {
  it("reads parts_json from the node", () => {
    expect(
      messageToMarkdown(
        node("n1", "assistant", null, [{ type: "text", text: "reply" }])
      )
    ).toBe("reply")
  })
})
