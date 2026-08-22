import { z } from "zod"
import { TREE_MAX_SCALE, TREE_MIN_SCALE } from "@/lib/tree-camera-constants"

export { TREE_MAX_SCALE, TREE_MIN_SCALE }

export const chatViewCameraSchema = z.object({
  anchorNodeId: z.string().min(1),
  /** Anchor centre relative to the viewport centre, in viewport proportions. */
  offsetX: z.number().finite(),
  offsetY: z.number().finite(),
  zoom: z.number().finite().min(TREE_MIN_SCALE).max(TREE_MAX_SCALE),
})

export const chatViewStateSchema = z.object({
  mode: z.enum(["linear", "tree"]),
  camera: chatViewCameraSchema.nullable(),
})

export type ChatViewCamera = z.infer<typeof chatViewCameraSchema>
export type ChatViewState = z.infer<typeof chatViewStateSchema>

export const DEFAULT_CHAT_VIEW_STATE: ChatViewState = {
  mode: "linear",
  camera: null,
}

export function chatViewStateToJson(state: ChatViewState) {
  return JSON.stringify(chatViewStateSchema.parse(state))
}

export function parseChatViewState(raw: string): ChatViewState {
  return chatViewStateSchema.parse(JSON.parse(raw))
}

export function chatViewCamerasEqual(
  a: ChatViewCamera | null,
  b: ChatViewCamera | null
) {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.anchorNodeId === b.anchorNodeId &&
    a.offsetX === b.offsetX &&
    a.offsetY === b.offsetY &&
    a.zoom === b.zoom
  )
}
