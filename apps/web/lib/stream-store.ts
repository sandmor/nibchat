"use client"
import { create } from "zustand"
import { reduceGenerationPayload, type GenerationPayload } from "@/lib/generation-streams/events"
import type { Parts } from "@/lib/types"

export type StreamMeta = {
  nodeId: string
  chatId: string
  /** Structural parent of the streaming assistant (tree placement). */
  parentNodeId: string | null
  startedAt: number
}

export type StreamBuffer = {
  parts: Parts
}

const emptyBuffer = (): StreamBuffer => ({
  parts: [],
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
  applyEvent: (streamId: string, event: GenerationPayload) => void
  attachController: (streamId: string, controller: AbortController) => void
  /** Stop is server-side; aborting only detaches this local subscription. */
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
  applyEvent: (streamId, event) =>
    set((state) => {
      const buffer = state.buffers[streamId]
      if (!buffer) return state
      return {
        buffers: {
          ...state.buffers,
          [streamId]: { parts: reduceGenerationPayload(buffer.parts, event) },
        },
      }
    }),
  attachController: (streamId, controller) =>
    set((state) => ({
      controllers: { ...state.controllers, [streamId]: controller },
    })),
  stop: (streamId) => {
    void fetch(`/api/chat/stream/${encodeURIComponent(streamId)}`, {
      method: "DELETE",
    })
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
