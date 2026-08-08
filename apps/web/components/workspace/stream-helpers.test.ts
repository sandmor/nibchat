import { describe, expect, it } from "vitest"
import {
  isViewingChat,
  shouldSoftFollow,
  streamPlacement,
  type StreamRequestBody,
} from "./stream-helpers"
import type { NodeRow } from "@/lib/types"

function node(id: string): NodeRow {
  return {
    id,
    chat_id: "c1",
    parent_id: null,
    role: "user",
    status: "complete",
    selected_child_id: null,
    parts_json: "[]",
    search_text: "",
    metadata_json: "{}",
    created_at: "",
    updated_at: "",
  }
}

describe("isViewingChat", () => {
  it("matches /chat/[id] from the pathname", () => {
    expect(isViewingChat("abc", null, "/chat/abc")).toBe(true)
    expect(isViewingChat("other", "abc", "/chat/abc")).toBe(false)
  })

  it("on /chat/new requires selection to match the created id", () => {
    expect(isViewingChat("abc", "abc", "/chat/new")).toBe(true)
    expect(isViewingChat("abc", null, "/chat/new")).toBe(false)
  })

  it("falls back to selection when pathname is unavailable", () => {
    expect(isViewingChat("abc", "abc", null)).toBe(true)
    expect(isViewingChat("abc", null, null)).toBe(false)
  })

  it("fails closed on non-chat paths even if selection matches", () => {
    expect(isViewingChat("abc", "abc", "/settings")).toBe(false)
    expect(isViewingChat("abc", "abc", "/login")).toBe(false)
  })
})

describe("shouldSoftFollow", () => {
  it("soft-follows continue from empty tip when still on that chat", () => {
    const body: StreamRequestBody = {
      chatId: "c1",
      intent: "continue",
      parentNodeId: null,
      content: "hi",
    }
    expect(shouldSoftFollow(body, [], "c1", "/chat/c1")).toBe(true)
  })

  it("does not soft-follow after navigating to another chat", () => {
    const body: StreamRequestBody = {
      chatId: "c1",
      intent: "continue",
      parentNodeId: null,
      content: "hi",
    }
    expect(shouldSoftFollow(body, [], "c1", "/chat/other")).toBe(false)
  })

  it("soft-follows continue when tip is still the parent", () => {
    const body: StreamRequestBody = {
      chatId: "c1",
      intent: "continue",
      parentNodeId: "u1",
      content: "hi",
    }
    expect(shouldSoftFollow(body, [node("u1")], "c1", "/chat/c1")).toBe(true)
    expect(shouldSoftFollow(body, [node("other")], "c1", "/chat/c1")).toBe(
      false
    )
  })
})

describe("streamPlacement", () => {
  it("places streams inline when the node is on the active path", () => {
    const path = [node("u1"), node("a1")]
    expect(
      streamPlacement({ nodeId: "a1", parentNodeId: "u1" }, path, path)
    ).toBe("inline")
  })

  it("hides streams that belong to another branch", () => {
    const u = node("u1")
    const a1 = { ...node("a1"), parent_id: "u1", selected_child_id: null }
    const a2 = { ...node("a2"), parent_id: "u1", selected_child_id: null }
    const path = [{ ...u, selected_child_id: "a1" }, a1]
    expect(
      streamPlacement({ nodeId: "a2", parentNodeId: "u1" }, path, [u, a1, a2])
    ).toBe("hidden")
  })

  it("shows under the tip when parent is tip and nothing else is selected", () => {
    const tip = { ...node("u1"), selected_child_id: null }
    expect(
      streamPlacement({ nodeId: "a1", parentNodeId: "u1" }, [tip], [tip])
    ).toBe("after-tip")
  })
})
