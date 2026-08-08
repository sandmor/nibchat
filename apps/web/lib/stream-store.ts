"use client"
import { create } from "zustand"
import type { ToolInvocationPart } from "@/lib/types"

export type ActiveStream = {
  nodeId: string
  chatId: string
  /** Structural parent of the streaming assistant (tree placement). */
  parentNodeId: string | null
  startedAt: number
  text: string
  reasoning: string
  /** In-flight tool invocations for multi-stage turns. */
  tools: ToolInvocationPart[]
}

type StreamState = {
  active: Record<string, ActiveStream>
  controllers: Record<string, AbortController>
  start: (
    streamId: string,
    value: {
      nodeId: string
      chatId: string
      parentNodeId: string | null
    }
  ) => void
  appendText: (streamId: string, delta: string) => void
  appendReasoning: (streamId: string, delta: string) => void
  upsertTool: (streamId: string, tool: ToolInvocationPart) => void
  attachController: (streamId: string, controller: AbortController) => void
  /** Abort a single in-tab stream (Stop button). Structural cancel is server-side. */
  stop: (streamId: string) => void
  finish: (streamId: string) => void
}
export const useStreamStore = create<StreamState>((set, get) => ({
  active: {},
  controllers: {},
  start: (streamId, value) =>
    set((state) => ({
      active: {
        ...state.active,
        [streamId]: {
          ...value,
          startedAt: Date.now(),
          text: "",
          reasoning: "",
          tools: [],
        },
      },
    })),
  appendText: (streamId, delta) =>
    set((state) => {
      const stream = state.active[streamId]
      if (!stream) return state
      return {
        active: {
          ...state.active,
          [streamId]: { ...stream, text: stream.text + delta },
        },
      }
    }),
  appendReasoning: (streamId, delta) =>
    set((state) => {
      const stream = state.active[streamId]
      if (!stream) return state
      return {
        active: {
          ...state.active,
          [streamId]: { ...stream, reasoning: stream.reasoning + delta },
        },
      }
    }),
  upsertTool: (streamId, tool) =>
    set((state) => {
      const stream = state.active[streamId]
      if (!stream) return state
      const tools = stream.tools.slice()
      const index = tools.findIndex((t) => t.toolCallId === tool.toolCallId)
      if (index === -1) tools.push(tool)
      else tools[index] = tool
      return {
        active: {
          ...state.active,
          [streamId]: { ...stream, tools },
        },
      }
    }),
  attachController: (streamId, controller) =>
    set((state) => ({
      controllers: { ...state.controllers, [streamId]: controller },
    })),
  stop: (streamId) => {
    get().controllers[streamId]?.abort()
  },
  finish: (streamId) =>
    set((state) => {
      const active = { ...state.active }
      const controllers = { ...state.controllers }
      delete active[streamId]
      delete controllers[streamId]
      return { active, controllers }
    }),
}))
