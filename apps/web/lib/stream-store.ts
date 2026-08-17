"use client"
import { create } from "zustand"
import type { ToolInvocationPart } from "@/lib/types"

export type StreamMeta = {
  nodeId: string
  chatId: string
  /** Structural parent of the streaming assistant (tree placement). */
  parentNodeId: string | null
  startedAt: number
}

export type StreamBuffer = {
  text: string
  reasoning: string
  tools: ToolInvocationPart[]
}

const emptyBuffer = (): StreamBuffer => ({
  text: "",
  reasoning: "",
  tools: [],
})

/** Read-only fallback so missing ids do not look like buffer updates. */
export const EMPTY_STREAM_BUFFER: StreamBuffer = emptyBuffer()

type StreamState = {
  streams: Record<string, StreamMeta>
  buffers: Record<string, StreamBuffer>
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
  streams: {},
  buffers: {},
  controllers: {},
  start: (streamId, value) =>
    set((state) => ({
      streams: {
        ...state.streams,
        [streamId]: {
          ...value,
          startedAt: Date.now(),
        },
      },
      buffers: {
        ...state.buffers,
        [streamId]: emptyBuffer(),
      },
    })),
  appendText: (streamId, delta) =>
    set((state) => {
      const buffer = state.buffers[streamId]
      if (!buffer) return state
      return {
        buffers: {
          ...state.buffers,
          [streamId]: { ...buffer, text: buffer.text + delta },
        },
      }
    }),
  appendReasoning: (streamId, delta) =>
    set((state) => {
      const buffer = state.buffers[streamId]
      if (!buffer) return state
      return {
        buffers: {
          ...state.buffers,
          [streamId]: { ...buffer, reasoning: buffer.reasoning + delta },
        },
      }
    }),
  upsertTool: (streamId, tool) =>
    set((state) => {
      const buffer = state.buffers[streamId]
      if (!buffer) return state
      const tools = buffer.tools.slice()
      const index = tools.findIndex((t) => t.toolCallId === tool.toolCallId)
      if (index === -1) tools.push(tool)
      else tools[index] = tool
      return {
        buffers: {
          ...state.buffers,
          [streamId]: { ...buffer, tools },
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
      const streams = { ...state.streams }
      const buffers = { ...state.buffers }
      const controllers = { ...state.controllers }
      delete streams[streamId]
      delete buffers[streamId]
      delete controllers[streamId]
      return { streams, buffers, controllers }
    }),
}))

export function useStreamBuffer(streamId: string): StreamBuffer {
  return useStreamStore(
    (state) => state.buffers[streamId] ?? EMPTY_STREAM_BUFFER
  )
}

export function chatStreamEntries(
  streams: Record<string, StreamMeta>,
  chatIds: ReadonlyArray<string | null | undefined>
): Array<[string, StreamMeta]> {
  const wanted = new Set<string>()
  for (const id of chatIds) {
    if (id) wanted.add(id)
  }
  return Object.entries(streams).filter(([, meta]) => wanted.has(meta.chatId))
}
