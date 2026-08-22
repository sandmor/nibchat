import { describe, expect, it } from "vitest"
import {
  chatViewCamerasEqual,
  chatViewStateToJson,
  parseChatViewState,
} from "@/lib/chat-view-state"

describe("chat view state", () => {
  it("round-trips a tree camera", () => {
    const state = {
      mode: "tree" as const,
      camera: {
        anchorNodeId: "n1",
        offsetX: 0.25,
        offsetY: -0.1,
        zoom: 0.9,
      },
    }
    expect(parseChatViewState(chatViewStateToJson(state))).toEqual(state)
  })

  it("treats identical cameras as equal", () => {
    const camera = {
      anchorNodeId: "n1",
      offsetX: 0.2,
      offsetY: 0.1,
      zoom: 0.9,
    }
    expect(chatViewCamerasEqual(camera, { ...camera })).toBe(true)
    expect(chatViewCamerasEqual(camera, { ...camera, zoom: 1 })).toBe(false)
    expect(chatViewCamerasEqual(camera, null)).toBe(false)
    expect(chatViewCamerasEqual(null, null)).toBe(true)
  })
})
