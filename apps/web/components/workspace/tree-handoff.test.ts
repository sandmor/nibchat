import { describe, expect, it } from "vitest"
import { composeLayoutId } from "./tree-layout"
import { collectHandoffs, uniqueHandoffAnchors } from "./tree-handoff"

const composer = { x: 80, y: 40, width: 360, height: 160 }
const message = { x: 40, y: 200, width: 360, height: 120 }

describe("collectHandoffs", () => {
  it("morphs from the composer rect captured by the send event", () => {
    const layoutId = composeLayoutId("parent")
    const handoffs = collectHandoffs(
      { user: layoutId },
      new Set(["user"]),
      new Map([[layoutId, composer]]),
      new Map([["user", message]])
    )
    expect(handoffs).toEqual([
      { userNodeId: "user", anchor: "parent", fromRect: composer },
    ])
  })

  it("falls back to the target rect when a tree remount lost the source", () => {
    const handoffs = collectHandoffs(
      { user: composeLayoutId("parent") },
      new Set(["user"]),
      new Map(),
      new Map([["user", message]])
    )
    expect(handoffs[0]!.fromRect).toEqual(message)
  })

  it("waits for the durable user node before creating a handoff", () => {
    const handoffs = collectHandoffs(
      { user: composeLayoutId("parent") },
      new Set(),
      new Map([[composeLayoutId("parent"), composer]]),
      new Map()
    )
    expect(handoffs).toEqual([])
  })
})

describe("uniqueHandoffAnchors", () => {
  it("lists each compose anchor once so unmount can finish every morph", () => {
    expect(
      uniqueHandoffAnchors({
        a: composeLayoutId("parent"),
        b: composeLayoutId("parent"),
        c: composeLayoutId(null),
      })
    ).toEqual(["parent", null])
  })
})
