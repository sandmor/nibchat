"use client"
import { create } from "zustand"
import {
  reduceGenerationPayload,
  type GenerationPayload,
} from "@/lib/generation-streams/events"
import type { Parts } from "@/lib/types"

export type StreamMeta = {
  nodeId: string
  chatId: string
  /** Structural parent of the streaming assistant (tree placement). */
  parentNodeId: string | null
  startedAt: number
  /** User cancelled the producer; overlay hides while the reader waits for SSE end. */
  stopping?: boolean
  /** Reader reached a terminal endpoint; hide it and block stale rediscovery. */
  settled?: boolean
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
  /** SSE resume cursors; not subscribed by placement or bubble UI. */
  cursors: Record<string, string>
  start: (
    streamId: string,
    value: {
      nodeId: string
      chatId: string
      parentNodeId: string | null
    }
  ) => void
  applyEvent: (streamId: string, event: GenerationPayload) => void
  setCursor: (streamId: string, cursor: string) => void
  attachController: (streamId: string, controller: AbortController) => void
  /** Drop this reader without clearing the token buffer. */
  detachController: (streamId: string, controller?: AbortController) => void
  /** Cancel the producer. Local abort is only for leaving a chat. */
  stop: (streamId: string) => void
  /** Preserve the final overlay and block rediscovery until workspace confirms it. */
  settle: (streamId: string) => void
  /** Permanently collect stream metadata and payload. */
  finish: (streamId: string) => void
}

export const useStreamStore = create<StreamState>((set, get) => ({
  streams: {},
  buffers: {},
  controllers: {},
  cursors: {},
  start: (streamId, value) =>
    set((state) => {
      const existing = state.streams[streamId]
      if (existing) {
        return {
          streams: {
            ...state.streams,
            [streamId]: {
              ...existing,
              ...value,
              startedAt: existing.startedAt,
              stopping: existing.stopping,
              settled: existing.settled,
            },
          },
        }
      }
      return {
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
      }
    }),
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
  setCursor: (streamId, cursor) =>
    set((state) => {
      if (!state.streams[streamId] || state.cursors[streamId] === cursor)
        return state
      return { cursors: { ...state.cursors, [streamId]: cursor } }
    }),
  attachController: (streamId, controller) =>
    set((state) => ({
      controllers: { ...state.controllers, [streamId]: controller },
    })),
  detachController: (streamId, controller) =>
    set((state) => {
      const current = state.controllers[streamId]
      if (!current) return state
      if (controller && current !== controller) return state
      const controllers = { ...state.controllers }
      delete controllers[streamId]
      return { controllers }
    }),
  stop: (streamId) => {
    const meta = get().streams[streamId]
    if (meta && !meta.stopping) {
      set((state) => ({
        streams: {
          ...state.streams,
          [streamId]: { ...meta, stopping: true },
        },
      }))
    }
    void fetch(`/api/chat/stream/${encodeURIComponent(streamId)}`, {
      method: "DELETE",
    })
  },
  settle: (streamId) =>
    set((state) => {
      const meta = state.streams[streamId]
      if (!meta || meta.settled) return state
      const controllers = { ...state.controllers }
      const cursors = { ...state.cursors }
      delete controllers[streamId]
      delete cursors[streamId]
      return {
        streams: {
          ...state.streams,
          [streamId]: { ...meta, settled: true },
        },
        controllers,
        cursors,
      }
    }),
  finish: (streamId) =>
    set((state) => {
      const streams = { ...state.streams }
      const buffers = { ...state.buffers }
      const controllers = { ...state.controllers }
      const cursors = { ...state.cursors }
      delete streams[streamId]
      delete buffers[streamId]
      delete controllers[streamId]
      delete cursors[streamId]
      return { streams, buffers, controllers, cursors }
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
  return Object.entries(streams).filter(
    ([, meta]) => wanted.has(meta.chatId) && !meta.stopping
  )
}

export function hasLiveStreamReader(
  controllers: Record<string, AbortController>,
  streamId: string
): boolean {
  const controller = controllers[streamId]
  return Boolean(controller && !controller.signal.aborted)
}

/**
 * Drop local SSE readers for these chats without cancelling the producer.
 * Token buffers stay so a later ChatView can follow from the stored cursor.
 * Stopping streams are aborted too — leave always drops local I/O.
 */
export function abortChatStreamReaders(
  chatIds: ReadonlyArray<string | null | undefined>
) {
  const wanted = new Set<string>()
  for (const id of chatIds) {
    if (id) wanted.add(id)
  }
  if (wanted.size === 0) return
  const { streams, controllers, detachController } = useStreamStore.getState()
  for (const [streamId, meta] of Object.entries(streams)) {
    if (!wanted.has(meta.chatId)) continue
    const controller = controllers[streamId]
    controller?.abort()
    if (controller) detachController(streamId, controller)
  }
}

/** Buffers for cancelled overlays; used so Stop can keep painting late tokens. */
export function collectStoppingBuffers(
  streams: Record<string, StreamMeta>,
  buffers: Record<string, StreamBuffer>
): Record<string, StreamBuffer> {
  const next: Record<string, StreamBuffer> = {}
  for (const [id, meta] of Object.entries(streams)) {
    if (!meta.stopping) continue
    next[id] = buffers[id] ?? EMPTY_STREAM_BUFFER
  }
  return next
}
